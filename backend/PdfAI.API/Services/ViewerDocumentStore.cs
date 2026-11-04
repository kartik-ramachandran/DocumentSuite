using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace PdfAI.API.Services;

public sealed class ViewerDocument(string id, string path, IReadOnlyList<ViewerPageSize> pages)
{
    public string Id { get; } = id;
    public string Path { get; } = path;
    public IReadOnlyList<ViewerPageSize> Pages { get; } = pages;
    public DateTimeOffset LastUsed { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>Filled in on the first text request, because reading scanned pages can take a while.</summary>
    public Task<IReadOnlyList<LayoutPage>>? Layout { get; set; }
}

public sealed record ViewerPageSize(double Width, double Height);

/// <summary>
/// Temporary storage for documents opened in the viewer's server mode. An ID is a long random value that acts as
/// the key to its document. Documents are deleted once idle, when the limit is reached and when the app stops.
/// </summary>
public sealed class ViewerDocumentStore : IDisposable
{
    private const int DefaultLifetimeMinutes = 30;
    private const int DefaultMaxDocuments = 200;
    private const int IdBytes = 32;
    private static readonly TimeSpan SweepInterval = TimeSpan.FromMinutes(1);

    private readonly ConcurrentDictionary<string, ViewerDocument> _documents = new();
    private readonly DirectoryInfo _directory = Directory.CreateTempSubdirectory("pdfsuite-viewer-");
    private readonly ILogger<ViewerDocumentStore> _logger;
    private readonly TimeSpan _lifetime;
    private readonly int _maxDocuments;
    private readonly Timer _sweeper;

    public ViewerDocumentStore(IConfiguration configuration, ILogger<ViewerDocumentStore> logger)
    {
        _logger = logger;
        _lifetime = TimeSpan.FromMinutes(configuration.GetValue("Viewer:DocumentLifetimeMinutes", DefaultLifetimeMinutes));
        _maxDocuments = configuration.GetValue("Viewer:MaxDocuments", DefaultMaxDocuments);
        _sweeper = new Timer(_ => RemoveExpired(DateTimeOffset.UtcNow), null, SweepInterval, SweepInterval);
    }

    public int Count => _documents.Count;

    public async Task<ViewerDocument> AddAsync(byte[] pdfBytes, IReadOnlyList<ViewerPageSize> pages, CancellationToken cancellationToken)
    {
        var id = Convert.ToHexString(RandomNumberGenerator.GetBytes(IdBytes)).ToLowerInvariant();
        var path = Path.Combine(_directory.FullName, $"{id}.pdf");
        await File.WriteAllBytesAsync(path, pdfBytes, cancellationToken);

        var document = new ViewerDocument(id, path, pages);
        _documents[id] = document;

        // Makes room by removing whichever documents have been idle longest.
        foreach (var stale in _documents.Values.OrderBy(entry => entry.LastUsed).Take(Math.Max(_documents.Count - _maxDocuments, 0)).ToList())
        {
            if (stale.Id != id)
                Remove(stale.Id);
        }

        return document;
    }

    public ViewerDocument? Find(string id)
    {
        if (!_documents.TryGetValue(id, out var document))
            return null;

        document.LastUsed = DateTimeOffset.UtcNow;
        return document;
    }

    public bool Remove(string id)
    {
        if (!_documents.TryRemove(id, out var document))
            return false;

        try
        {
            File.Delete(document.Path);
        }
        catch (IOException ex)
        {
            // A render may still have it open. The folder is deleted when the app stops.
            _logger.LogDebug(ex, "Could not delete a viewer document yet");
        }

        return true;
    }

    public int RemoveExpired(DateTimeOffset now)
    {
        var expired = _documents.Values.Where(document => now - document.LastUsed > _lifetime).Select(document => document.Id).ToList();
        foreach (var id in expired)
            Remove(id);
        return expired.Count;
    }

    public void Dispose()
    {
        _sweeper.Dispose();
        try
        {
            _directory.Delete(recursive: true);
        }
        catch (IOException ex)
        {
            _logger.LogWarning(ex, "Could not delete the viewer's temporary folder");
        }
    }
}
