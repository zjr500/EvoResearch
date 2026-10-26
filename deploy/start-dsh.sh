#!/bin/sh
set -eu
node /opt/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js web --dump-config >/dev/null
pnpm --dir /dsh/profiles/web add file:/opt/plugin --ignore-scripts
cp /opt/plugin/cordis.patch.yml /dsh/profiles/web/cordis.patch.yml
exec node /opt/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js web --no-open --host 0.0.0.0 --port 9000
