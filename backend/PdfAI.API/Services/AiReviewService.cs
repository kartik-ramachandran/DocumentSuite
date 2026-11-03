using Azure;
using Azure.AI.OpenAI;
using OpenAI.Chat;
using System.Text.Json;
using PdfAI.API.Models;

namespace PdfAI.API.Services;

public class AiReviewService
{
    private readonly AzureOpenAIClient? _client;
    private readonly string _deployment;
    private readonly ILogger<AiReviewService> _logger;

    public AiReviewService(IConfiguration configuration, ILogger<AiReviewService> logger)
    {
        _logger = logger;
        var endpoint = configuration["AzureOpenAI:Endpoint"];
        var apiKey = configuration["AzureOpenAI:ApiKey"];
        _deployment = configuration["AzureOpenAI:DeploymentName"] ?? "gpt-4o";

        if (string.IsNullOrWhiteSpace(endpoint) || string.IsNullOrWhiteSpace(apiKey))
        {
            _logger.LogWarning("AiReview: Azure OpenAI endpoint or key not configured.");
            return;
        }

        _client = new AzureOpenAIClient(new Uri(endpoint), new AzureKeyCredential(apiKey));
    }

    public async Task<DocumentReviewResult> ReviewAsync(DocumentReviewRequest request)
    {
        if (_client is null)
        {
            throw new InvalidOperationException("Azure OpenAI is not configured. Set AzureOpenAI:Endpoint and AzureOpenAI:ApiKey in appsettings.");
        }

        var textSnippet = string.IsNullOrWhiteSpace(request.ExtractedText)
            ? "(no extractable text — may be a scanned PDF)"
            : request.ExtractedText.Length > 4000
                ? request.ExtractedText[..4000] + "\n...[truncated]"
                : request.ExtractedText;

        var systemPrompt =
            "You are a document analyst. Review the provided PDF content and respond with valid JSON only — no markdown fences, no extra text. " +
            "Schema: { \"summary\": string, \"keyPoints\": string[], \"issues\": string[], \"sentiment\": string }";

        var userPrompt =
            $"File: {request.FileName}\nPages: {request.PageCount?.ToString() ?? "unknown"}\n\nContent:\n{textSnippet}";

        var messages = new List<ChatMessage>
        {
            new SystemChatMessage(systemPrompt),
            new UserChatMessage(userPrompt)
        };

        var chat = _client.GetChatClient(_deployment);
        var response = await chat.CompleteChatAsync(messages);
        var raw = response.Value.Content[0].Text;

        try
        {
            var parsed = JsonSerializer.Deserialize<JsonElement>(raw);
            return new DocumentReviewResult
            {
                Summary = parsed.GetProperty("summary").GetString() ?? string.Empty,
                KeyPoints = parsed.GetProperty("keyPoints").EnumerateArray().Select(e => e.GetString() ?? string.Empty).ToList(),
                Issues = parsed.GetProperty("issues").EnumerateArray().Select(e => e.GetString() ?? string.Empty).ToList(),
                Sentiment = parsed.GetProperty("sentiment").GetString() ?? string.Empty,
                Model = _deployment
            };
        }
        catch
        {
            return new DocumentReviewResult
            {
                Summary = raw,
                Model = _deployment
            };
        }
    }
}
