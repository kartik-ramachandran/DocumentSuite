using FluentAssertions;
using Microsoft.Extensions.Configuration;
using PdfAI.API.Mcp;

namespace PdfAI.API.Tests;

public sealed class McpWorkspaceTests : IDisposable
{
    private readonly DirectoryInfo _parent = Directory.CreateTempSubdirectory("mcp-workspace-test-");
    private readonly McpWorkspace _workspace;
    private readonly string _root;

    public McpWorkspaceTests()
    {
        _root = Path.Combine(_parent.FullName, "workspace");
        _workspace = new McpWorkspace(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Mcp:WorkspaceRoot"] = _root,
                ["MaxFileSizeMB"] = "1"
            })
            .Build());
    }

    public void Dispose() => _parent.Delete(true);

    [Theory]
    [InlineData("../secret.pdf")]
    [InlineData("..")]
    [InlineData("a/../../secret.pdf")]
    public void Resolve_RejectsPathsThatLeaveTheWorkspace(string path)
    {
        var act = () => _workspace.Resolve(path);

        act.Should().Throw<UnauthorizedAccessException>();
    }

    [Fact]
    public void Resolve_RejectsAbsolutePathsOutsideAndSiblingFoldersWithSamePrefix()
    {
        var outside = () => _workspace.Resolve(Path.Combine(_parent.FullName, "secret.pdf"));
        var sibling = () => _workspace.Resolve(_root + "-other" + Path.DirectorySeparatorChar + "secret.pdf");

        outside.Should().Throw<UnauthorizedAccessException>();
        sibling.Should().Throw<UnauthorizedAccessException>();
    }

    [Fact]
    public void Resolve_AcceptsPathsInsideTheWorkspace()
    {
        _workspace.Resolve("folder/report.pdf").Should().Be(Path.Combine(_root, "folder", "report.pdf"));
        _workspace.Resolve(Path.Combine(_root, "report.pdf")).Should().Be(Path.Combine(_root, "report.pdf"));
    }

    [Fact]
    public void Resolve_RejectsSymbolicLinks()
    {
        var target = Path.Combine(_parent.FullName, "secret.pdf");
        File.WriteAllText(target, "secret");
        var link = Path.Combine(_root, "link.pdf");
        try
        {
            File.CreateSymbolicLink(link, target);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return; // Creating links needs extra rights on Windows. The Docker end-to-end test covers this on Linux.
        }

        var act = () => _workspace.Resolve("link.pdf");

        act.Should().Throw<UnauthorizedAccessException>();
    }

    [Fact]
    public async Task WriteAsync_NeverOverwritesAndForcesTheExtension()
    {
        var first = await _workspace.WriteAsync("out/report.exe", "ignored.pdf", "docx", [1], CancellationToken.None);
        var second = await _workspace.WriteAsync("out/report.docx", "ignored.pdf", "docx", [2], CancellationToken.None);

        first.Should().Be("out/report.docx");
        second.Should().Be("out/report_1.docx");
        File.ReadAllBytes(Path.Combine(_root, "out", "report.docx")).Should().Equal(1);
    }

    [Fact]
    public async Task WriteAsync_RejectsOutputOutsideTheWorkspace()
    {
        var act = () => _workspace.WriteAsync("../escape.pdf", "ignored.pdf", "pdf", [1], CancellationToken.None);

        await act.Should().ThrowAsync<UnauthorizedAccessException>();
        File.Exists(Path.Combine(_parent.FullName, "escape.pdf")).Should().BeFalse();
    }

    [Fact]
    public async Task ReadAsync_RejectsFilesOverTheSizeLimit()
    {
        await File.WriteAllBytesAsync(Path.Combine(_root, "big.pdf"), new byte[1024 * 1024 + 1]);

        var act = () => _workspace.ReadAsync("big.pdf", CancellationToken.None);

        await act.Should().ThrowAsync<InvalidOperationException>();
    }
}
