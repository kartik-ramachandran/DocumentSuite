using System.Security.Cryptography;
using System.Text;
using PdfAI.API.Mcp;
using PdfAI.API.Middleware;
using PdfAI.API.Services;

const string McpStdioFlag = "--mcp-stdio";
const string McpRoute = "/mcp";

if (args.Contains(McpStdioFlag))
{
    await RunMcpStdioAsync(args.Where(arg => arg != McpStdioFlag).ToArray());
    return;
}

var builder = WebApplication.CreateBuilder(args);

// Allow up to 100 MB uploads
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 104_857_600);
builder.Services.Configure<Microsoft.AspNetCore.Http.Features.FormOptions>(o =>
{
    o.MultipartBodyLengthLimit = 104_857_600;
    o.ValueLengthLimit         = 104_857_600;
});

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

builder.Services.AddCors(options =>
{
    options.AddPolicy("Open", policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyHeader()
              .AllowAnyMethod()
              .WithExposedHeaders("X-Ocr-Page-Count", "X-Redacted-Word-Count", "X-Redacted-Page-Count");
    });
});

AddPdfServices(builder.Services);
builder.Services.AddSingleton<ViewerDocumentStore>();
builder.Services.AddSingleton<ViewerSettingsStore>();

// MCP tools read and write server files, so the HTTP endpoint only exists once a key and folder are configured.
var mcpApiKey = builder.Configuration["Mcp:ApiKey"];
var mcpEnabled = !string.IsNullOrWhiteSpace(mcpApiKey) && !string.IsNullOrWhiteSpace(builder.Configuration["Mcp:WorkspaceRoot"]);
if (mcpEnabled)
{
    builder.Services.AddSingleton<McpWorkspace>();
    builder.Services.AddMcpServer()
        .WithHttpTransport(options => options.Stateless = true)
        .WithTools<PdfMcpTools>();
}

builder.Services.Configure<IISServerOptions>(options =>
{
    options.MaxRequestBodySize = 104857600; // 100 MB
});

var app = builder.Build();

app.UseSwagger();
app.UseSwaggerUI();

// CORS comes first so that browsers' preflight requests are answered before any other handling.
app.UseCors("Open");

// Runs before routing, because it rewrites JSON requests onto the normal /api/pdf routes.
app.UseMiddleware<JsonDocumentMiddleware>();
app.UseRouting();

if (mcpEnabled)
{
    var expectedKey = SHA256.HashData(Encoding.UTF8.GetBytes(mcpApiKey!));
    app.UseWhen(context => context.Request.Path.StartsWithSegments(McpRoute), branch => branch.Use(async (context, next) =>
    {
        var header = context.Request.Headers.Authorization.ToString();
        var provided = header.StartsWith("Bearer ", StringComparison.Ordinal) ? header["Bearer ".Length..] : string.Empty;
        if (!CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(provided)), expectedKey))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }

        await next();
    }));
}

app.UseHttpsRedirection();
app.MapControllers();
if (mcpEnabled)
    app.MapMcp(McpRoute);

app.Run();

static void AddPdfServices(IServiceCollection services)
{
    services.AddScoped<PdfToolRunner>();
    services.AddScoped<PdfLayoutService>();
    services.AddScoped<PdfCompressionService>();
    services.AddScoped<PdfToolkitService>();
    services.AddScoped<DocumentConversionService>();
    services.AddScoped<PdfProcessingService>();
    services.AddScoped<PdfCompareService>();
    services.AddScoped<ValidationAgentService>();
    services.AddScoped<AiReviewService>();
}

// Runs as a local process for one client. Standard output carries the MCP protocol, so logs go to standard error.
static async Task RunMcpStdioAsync(string[] arguments)
{
    var builder = Host.CreateApplicationBuilder(arguments);
    builder.Logging.ClearProviders();
    builder.Logging.AddConsole(options => options.LogToStandardErrorThreshold = LogLevel.Trace);

    AddPdfServices(builder.Services);
    builder.Services.AddSingleton<McpWorkspace>();
    builder.Services.AddMcpServer()
        .WithStdioServerTransport()
        .WithTools<PdfMcpTools>();

    await builder.Build().RunAsync();
}

// Lets the integration tests host the app.
public partial class Program;
