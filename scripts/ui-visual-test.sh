#!/usr/bin/env bash
# UI visual test against the STATIC export — auth → home → focus → srs → stats →
# settings, AR + EN, mobile + desktop. Serves out/ via scripts/static-preview.mjs
# (no Node.js server, no API routes — exactly what a static host serves).
set -u
cd /home/z/my-project/lastdays

pkill -f "static-preview.mjs" 2>/dev/null || true; sleep 1
export PORT=3111
setsid nohup node scripts/static-preview.mjs 3111 > /tmp/lastdays-static.log 2>&1 < /dev/null &
for i in $(seq 1 20); do sleep 0.5; curl -s -o /dev/null localhost:3111/ && break; done
echo "static server up"

AB="agent-browser"
mkdir -p /tmp/render

echo "=== mobile AR: onboarding page ==="
$AB set viewport 390 844
$AB open http://localhost:3111/ > /dev/null
$AB wait --load networkidle > /dev/null
$AB find role button click --name "إنشاء حساب" 2>/dev/null || true
sleep 1
$AB find label "الاسم" fill "AHMED"
sleep 1
$AB click "form button"
sleep 4
$AB wait --load networkidle > /dev/null
echo "url after onboarding: $($AB get url)"
$AB screenshot /tmp/render/02-home-mobile-ar.png --full

echo "=== home page content check ==="
$AB snapshot -i > /tmp/render/02-home-snapshot.txt
if rg -q "XP|شارة|الستريك" /tmp/render/02-home-snapshot.txt; then echo "FAIL gamification on home"; else echo "PASS no gamification on home"; fi
rg -q "امتحاناتك" /tmp/render/02-home-snapshot.txt && echo "PASS exams section present"
rg -q "تركيز اليوم" /tmp/render/02-home-snapshot.txt && echo "PASS focus-today chip present"

echo "=== focus page + timer persistence ==="
$AB open http://localhost:3111/focus > /dev/null
$AB wait --load networkidle > /dev/null
$AB snapshot -i > /tmp/render/03-focus-snapshot.txt
$AB find role button click --name "ابدأ"
sleep 2
$AB screenshot /tmp/render/03-focus-mobile-ar.png --full
$AB open http://localhost:3111/tasks > /dev/null
$AB wait --load networkidle > /dev/null
$AB open http://localhost:3111/focus > /dev/null
$AB wait --load networkidle > /dev/null
echo "timer after nav away+back (should be running):"
$AB snapshot -i | rg -o "2[0-4]:[0-9]{2}" | head -1

echo "=== srs page ==="
$AB open http://localhost:3111/srs > /dev/null
$AB wait --load networkidle > /dev/null
$AB screenshot /tmp/render/04-srs-mobile-ar.png --full

echo "=== stats page ==="
$AB open http://localhost:3111/stats > /dev/null
$AB wait --load networkidle > /dev/null
$AB screenshot /tmp/render/05-stats-mobile-ar.png --full
$AB snapshot -i > /tmp/render/05-stats-snapshot.txt
if rg -q "الشارات|الستريك" /tmp/render/05-stats-snapshot.txt; then echo "FAIL badges/streak on stats"; else echo "PASS stats clean of gamification"; fi
rg -q "إجمالي الساعات" /tmp/render/05-stats-snapshot.txt && echo "PASS totals present"

echo "=== settings page (backup + local notice) ==="
$AB open http://localhost:3111/settings > /dev/null
$AB wait --load networkidle > /dev/null
$AB screenshot /tmp/render/06-settings-mobile-ar.png --full
$AB snapshot -i > /tmp/render/06-settings-snapshot.txt
rg -q "النسخ الاحتياطي والاستعادة" /tmp/render/06-settings-snapshot.txt && echo "PASS backup & restore present"
rg -q "بياناتك محفوظة" /tmp/render/06-settings-snapshot.txt && echo "PASS local-data notice present"
if rg -q "تفعيل الإشعارات" /tmp/render/06-settings-snapshot.txt; then echo "FAIL server-push UI remains"; else echo "PASS no server-push UI"; fi

echo "=== switch to English ==="
$AB find text "English" click 2>/dev/null || true
sleep 2
$AB wait --load networkidle > /dev/null
$AB screenshot /tmp/render/07-settings-mobile-en.png --full
$AB snapshot -i > /tmp/render/07-settings-en-snapshot.txt
rg -q "Language" /tmp/render/07-settings-en-snapshot.txt && echo "PASS EN language applied"

echo "=== EN home (session persists) ==="
$AB open http://localhost:3111/home > /dev/null
$AB wait --load networkidle > /dev/null
$AB screenshot /tmp/render/08-home-mobile-en.png --full

echo "=== desktop viewport ==="
$AB set viewport 1440 900
$AB open http://localhost:3111/home > /dev/null
$AB wait --load networkidle > /dev/null
$AB screenshot /tmp/render/09-home-desktop.png --full
$AB open http://localhost:3111/focus > /dev/null
$AB wait --load networkidle > /dev/null
$AB screenshot /tmp/render/10-focus-desktop.png --full

$AB close > /dev/null 2>&1 || true
pkill -f "static-preview.mjs" 2>/dev/null || true
echo "done"
