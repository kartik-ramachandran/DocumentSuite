namespace PdfAI.API.Mcp;

/// <summary>
/// The only folder MCP tools can read or write. Clients pass paths instead of file contents, so
/// documents never pass through the AI model, and this class stops those paths leaving the folder.
/// </summary>
public class McpWorkspace
{
    private const int DefaultMaxFileSizeMb = 100;
    private const int MaxUniqueNameAttempts = 10_000;
    private readonly long _maxFileSizeBytes;

    public McpWorkspace(IConfiguration configuration)
    {
        var configured = configuration["Mcp:WorkspaceRoot"];
        Root = Path.GetFullPath(string.IsNullOrWhiteSpace(configured) ? Directory.GetCurrentDirectory() : configured);
        Directory.CreateDirectory(Root);
        _maxFileSizeBytes = configuration.GetValue("MaxFileSizeMB", DefaultMaxFileSizeMb) * 1024L * 1024L;
    }

    public string Root { get; }

    public async Task<byte[]> ReadAsync(string path, CancellationToken cancellationToken)
    {
        var fullPath = Resolve(path);
        var info = new FileInfo(fullPath);
        if (!info.Exists)
            throw new FileNotFoundException($"File not found: {path}");
        if (info.Length > _maxFileSizeBytes)
            throw new InvalidOperationException($"{path} is larger than the {_maxFileSizeBytes / (1024 * 1024)} MB limit.");

        return await File.ReadAllBytesAsync(fullPath, cancellationToken);
    }

    /// <summary>
    /// Writes a result and returns its path relative to the workspace. Existing files are never overwritten:
    /// the name gets a numeric suffix instead. The extension always matches the content.
    /// </summary>
    public async Task<string> WriteAsync(string? output, string defaultSource, string extension, byte[] content, CancellationToken cancellationToken)
    {
        var requested = string.IsNullOrWhiteSpace(output) ? defaultSource : output;
        var fullPath = Path.ChangeExtension(Resolve(requested), extension);
        Resolve(fullPath);
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);

        for (var attempt = 0; attempt < MaxUniqueNameAttempts; attempt++)
        {
            var candidate = attempt == 0
                ? fullPath
                : Path.Combine(Path.GetDirectoryName(fullPath)!, $"{Path.GetFileNameWithoutExtension(fullPath)}_{attempt}.{extension}");

            try
            {
                // CreateNew fails if the file exists, so two simultaneous calls can't overwrite each other.
                await using var stream = new FileStream(candidate, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                await stream.WriteAsync(content, cancellationToken);
                return ToRelative(candidate);
            }
            catch (IOException) when (File.Exists(candidate))
            {
                // Name taken, so try the next suffix.
            }
        }

        throw new IOException($"Could not find a free file name for {requested}.");
    }

    public string Resolve(string path)
    {
        if (string.IsNullOrWhiteSpace(path))
            throw new ArgumentException("A file path is required.");

        var relativeOrFull = Path.IsPathRooted(path) ? path : Path.Combine(Root, path);
        var fullPath = Path.GetFullPath(relativeOrFull);

        var relative = Path.GetRelativePath(Root, fullPath);
        if (relative == ".." || relative.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.Ordinal) || Path.IsPathRooted(relative))
            throw new UnauthorizedAccessException("Path is outside the workspace.");

        // Blocks NTFS alternate data streams, such as "report.pdf:hidden".
        if (relative.Contains(':'))
            throw new UnauthorizedAccessException("Path contains an invalid character.");

        // A link inside the workspace could otherwise point anywhere on the machine.
        var current = Root;
        foreach (var segment in relative.Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, segment);
            if ((File.Exists(current) && new FileInfo(current).LinkTarget is not null)
                || (Directory.Exists(current) && new DirectoryInfo(current).LinkTarget is not null))
            {
                throw new UnauthorizedAccessException("Symbolic links are not allowed in workspace paths.");
            }
        }

        return fullPath;
    }

    private string ToRelative(string fullPath) => Path.GetRelativePath(Root, fullPath).Replace('\\', '/');
}
