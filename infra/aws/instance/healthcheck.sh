#!/bin/bash
# Every minute (cron): two probes, published for the CloudWatch alarms.
#   SomaCue/Healthy        the app answers on this host (also covers the database)
#   SomaCue/PublicHealthy  the public address answers through CloudFront and DNS (covers the edge, the certificate and the
#                          origin lock; CloudWatch alarms for CloudFront itself cannot be created in this account)
. /etc/somacue/config
probe() { if curl -fsS -m 8 "$1" >/dev/null 2>&1; then echo 1; else echo 0; fi; }
local_ok="$(probe http://127.0.0.1:3100/api/health)"
public_ok="$(probe "https://${DOMAIN}/api/health")"
aws cloudwatch put-metric-data --region "$REGION" --namespace SomaCue --metric-data \
  "MetricName=Healthy,Value=$local_ok" "MetricName=PublicHealthy,Value=$public_ok" >/dev/null 2>&1 || true
