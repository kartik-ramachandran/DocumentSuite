# The Document Suite OCR service: PaddleOCR (Apache 2.0) behind a small HTTP API.
#
# CPU (default):  docker build -t document-suite-ocr ocr-service
# NVIDIA GPU:     docker build -t document-suite-ocr:gpu \
#                   --build-arg PADDLE_PACKAGE=paddlepaddle-gpu==3.2.2 \
#                   --build-arg PADDLE_INDEX=https://www.paddlepaddle.org.cn/packages/stable/cu126/ ocr-service
FROM python:3.12-slim

# 3.2.2 rather than 3.3: PaddlePaddle 3.3's oneDNN CPU kernels fail on the PP-OCR models, and without oneDNN OCR is ten times slower.
ARG PADDLE_PACKAGE=paddlepaddle==3.2.2
ARG PADDLE_INDEX=https://pypi.org/simple

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --index-url "$PADDLE_INDEX" --extra-index-url https://pypi.org/simple "$PADDLE_PACKAGE" \
    && pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Models download on first use into this folder, so mount a volume here to keep them between restarts.
RUN useradd --create-home --uid 10001 ocr && mkdir -p /home/ocr/.paddlex && chown -R ocr /home/ocr
USER ocr
ENV HOME=/home/ocr \
    PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True \
    PYTHONUNBUFFERED=1

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
