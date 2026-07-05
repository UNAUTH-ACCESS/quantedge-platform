#!/bin/bash
# QuantEdge SSL Bootstrap Script
# Run once after pointing DuckDNS to your server IP
# Usage: ./scripts/init-ssl.sh your-subdomain.duckdns.org your@email.com

set -e

DOMAIN=${1:?"Usage: $0 <domain> <email>"}
EMAIL=${2:?"Usage: $0 <domain> <email>"}

echo "========================================"
echo "  QuantEdge SSL Bootstrap"
echo "  Domain: $DOMAIN"
echo "  Email:  $EMAIL"
echo "========================================"

# Step 1 — Patch domain into nginx configs
echo "[1/6] Patching domain into nginx configs..."
sed -i "s/DOMAIN_PLACEHOLDER/$DOMAIN/g" nginx/nginx.conf
sed -i "s/DOMAIN_PLACEHOLDER/$DOMAIN/g" nginx/nginx-staging.conf
echo "      Done."

# Step 2 — Patch domain into .env
echo "[2/6] Updating .env..."
sed -i "s|DOMAIN=.*|DOMAIN=$DOMAIN|g" .env
sed -i "s|VITE_API_URL=.*|VITE_API_URL=https://$DOMAIN|g" .env
sed -i "s|VITE_WS_URL=.*|VITE_WS_URL=https://$DOMAIN|g" .env
sed -i "s|CORS_ORIGIN=.*|CORS_ORIGIN=https://$DOMAIN|g" .env
echo "      Done."

# Step 3 — Start with staging config (HTTP only) for ACME challenge
echo "[3/6] Starting services with HTTP-only config for cert issuance..."
cp nginx/nginx-staging.conf nginx/active.conf
docker compose up -d postgres api worker frontend
docker compose up -d nginx
sleep 5
echo "      Services started."

# Step 4 — Issue certificate via Certbot webroot challenge
echo "[4/6] Issuing Let's Encrypt certificate..."
docker compose run --rm certbot certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    --email "$EMAIL" \
    --agree-tos \
    --no-eff-email \
    --domain "$DOMAIN"
echo "      Certificate issued."

# Step 5 — Switch to full SSL nginx config
echo "[5/6] Switching to SSL config..."
cp nginx/nginx.conf nginx/active.conf
docker compose exec nginx nginx -s reload
echo "      Nginx reloaded with SSL."

# Step 6 — Verify
echo "[6/6] Verifying HTTPS..."
sleep 3
HTTP_CODE=$(curl -sk -o /dev/null -w "%{http_code}" "https://$DOMAIN/health" || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
    echo ""
    echo "✓ SSL bootstrap complete!"
    echo "✓ Application live at: https://$DOMAIN"
else
    echo ""
    echo "⚠ Health check returned HTTP $HTTP_CODE"
    echo "  Check logs: docker compose logs nginx"
fi
