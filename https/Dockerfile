FROM caddy:2.11.4-builder AS builder
RUN xcaddy build v2.11.4 --with github.com/caddy-dns/cloudflare@v0.2.4 \
    --with github.com/mholt/caddy-l4@42db5690dea199f930a6f08005fe2e4aab10dcc9

FROM caddy:2.11.4
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
