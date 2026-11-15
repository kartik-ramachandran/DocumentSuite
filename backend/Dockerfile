FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS base
WORKDIR /app

# OCR languages, as Ubuntu's Tesseract package names without the tesseract-ocr- prefix.
# Add more with --build-arg, such as "eng deu chi-sim jpn ara hin". See `apt-cache search tesseract-ocr-`.
ARG TESSERACT_LANGS="eng deu fra spa ita por nld"

# On Ubuntu 24.04 (the .NET 10 base image), the chromium package is a snap wrapper
# that can't run in containers. Install Google Chrome from Google's repo instead.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libreoffice \
        poppler-utils \
        qpdf \
        tesseract-ocr \
        tesseract-ocr-osd \
        $(for lang in $TESSERACT_LANGS; do printf 'tesseract-ocr-%s ' "$lang"; done) \
        fontconfig \
        xvfb \
        xauth \
        wget \
        fonts-liberation \
        fonts-crosextra-carlito \
        fonts-crosextra-caladea \
        fonts-dejavu \
        fonts-noto-core \
        fonts-freefont-ttf \
    && wget -qO /tmp/chrome.deb "https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb" \
    && apt-get install -y /tmp/chrome.deb \
    && fc-cache -fv \
    && rm -rf /tmp/chrome.deb /var/lib/apt/lists/*

ENV SAL_USE_VCLPLUGIN=gen
ENV Tools__Browser__Path=/usr/bin/google-chrome-stable

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY ["PdfAI.API/PdfAI.API.csproj", "PdfAI.API/"]
RUN dotnet restore "PdfAI.API/PdfAI.API.csproj"
COPY . .
WORKDIR "/src/PdfAI.API"
RUN dotnet publish "PdfAI.API.csproj" -c Release -o /app/publish

FROM base AS final
WORKDIR /app
COPY --from=build /app/publish .
EXPOSE 8080
ENTRYPOINT ["dotnet", "PdfAI.API.dll"]
