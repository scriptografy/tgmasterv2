#!/usr/bin/env bash
set -euo pipefail

tor -f /etc/tor/torrc &
exec node server/index.js
