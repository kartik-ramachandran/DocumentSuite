using System.Text.RegularExpressions;

namespace PdfAI.API.Services;

/// <summary>Keeps each scope's viewer settings in a small JSON file, so they survive restarts without needing a database.</summary>
public sealed partial class ViewerSettingsStore
{
    private const int MaxScopes = 10_000;

    private readonly string _folder;
    private readonly SemaphoreSlim _lock = new(1, 1);

    public ViewerSettingsStore(IConfiguration configuration, IHostEnvironment environment)
    {
        var configured = configuration["Settings:Path"];
        _folder = string.IsNullOrWhiteSpace(configured) ? Path.Combine(environment.ContentRootPath, "data", "settings") : configured;
    }

    /// <summary>Scopes become part of a file name, so only characters that can't leave the folder are allowed.</summary>
    public static bool IsValidScope(string scope) => ScopePattern().IsMatch(scope);

    public async Task<string?> ReadAsync(string scope, CancellationToken cancellationToken)
    {
        var path = PathFor(scope);
        return File.Exists(path) ? await File.ReadAllTextAsync(path, cancellationToken) : null;
    }

    /// <summary>Returns false when the store is full.</summary>
    public async Task<bool> WriteAsync(string scope, string json, CancellationToken cancellationToken)
    {
        await _lock.WaitAsync(cancellationToken);
        try
        {
            Directory.CreateDirectory(_folder);
            var path = PathFor(scope);
            if (!File.Exists(path) && Directory.EnumerateFiles(_folder, "settings-*.json").Count() >= MaxScopes) return false;

            // Writing to one side first means a crash can't leave a half-written file.
            var temporary = $"{path}.{Guid.NewGuid():N}.tmp";
            await File.WriteAllTextAsync(temporary, json, cancellationToken);
            File.Move(temporary, path, overwrite: true);
            return true;
        }
        finally
        {
            _lock.Release();
        }
    }

    public async Task DeleteAsync(string scope, CancellationToken cancellationToken)
    {
        await _lock.WaitAsync(cancellationToken);
        try
        {
            File.Delete(PathFor(scope));
        }
        finally
        {
            _lock.Release();
        }
    }

    // The prefix also avoids names that Windows reserves, such as CON and NUL.
    private string PathFor(string scope) => Path.Combine(_folder, $"settings-{scope}.json");

    [GeneratedRegex("^[A-Za-z0-9_-]{1,64}$")]
    private static partial Regex ScopePattern();
}
