FROM debian:trixie-slim

# signal-cli release to install. Check https://github.com/AsamK/signal-cli/releases
# for newer versions; Signal changes things occasionally and old releases stop working.
ARG SIGNAL_CLI_VERSION=0.14.8

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 curl ca-certificates qrencode \
 && curl -fsSL -o /tmp/signal-cli.tar.gz \
    "https://github.com/AsamK/signal-cli/releases/download/v${SIGNAL_CLI_VERSION}/signal-cli-${SIGNAL_CLI_VERSION}-Linux-native.tar.gz" \
 && tar xf /tmp/signal-cli.tar.gz -C /opt \
 && ln -sf /opt/signal-cli /usr/local/bin/signal-cli \
 && rm /tmp/signal-cli.tar.gz \
 && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home app \
 && mkdir -p /home/app/.local/share/signal-cli \
 && chown -R app:app /home/app/.local

WORKDIR /srv
COPY app.py index.html ./
USER app

ENV BROADCAST_HOST=0.0.0.0 BROADCAST_PORT=8765 PYTHONUNBUFFERED=1
CMD ["python3", "app.py"]
