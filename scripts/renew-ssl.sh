#!/bin/bash
# Certificate renewal — run by cron twice daily
# Add to crontab: 0 0,12 * * * /home/solana/quantedge/scripts/renew-ssl.sh >> /var/log/certbot-renew.log 2>&1

cd /home/solana/quantedge
docker compose run --rm certbot renew --quiet
docker compose exec nginx nginx -s reload
