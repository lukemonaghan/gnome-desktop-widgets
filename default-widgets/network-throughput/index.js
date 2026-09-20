// Network Throughput Widget
// Live download/upload speed, summed over every interface except loopback
// (read from /proc/net/dev once a second).

var label;
var prev = null;

function formatRate(bytes) {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB/s';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB/s';
  return Math.round(bytes) + ' B/s';
}

function readTotals(ctx) {
  try {
    var res = ctx.GLib.file_get_contents('/proc/net/dev');
    if (!res[0]) return null;
    var rx = 0;
    var tx = 0;
    var lines = new TextDecoder().decode(res[1]).split('\n').slice(2);
    lines.forEach(function (line) {
      var parts = line.split(':');
      if (parts.length < 2 || parts[0].trim() === 'lo') return;
      var f = parts[1].trim().split(/\s+/).map(Number);
      rx += f[0] || 0;
      tx += f[8] || 0;
    });
    return { rx: rx, tx: tx };
  } catch (e) {
    return null;
  }
}

function render(ctx, api) {
  label = new ctx.St.Label({ text: '↓ --\n↑ --' });
  ctx.box.add_child(label);
}

function update(ctx, api) {
  var now = readTotals(ctx);
  if (!now) {
    label.set_text('Network stats unavailable');
    return;
  }
  if (prev) {
    // Counters reset if an interface disappears; never show negative speeds
    var down = Math.max(0, now.rx - prev.rx);
    var up = Math.max(0, now.tx - prev.tx);
    label.set_text('↓ ' + formatRate(down) + '\n↑ ' + formatRate(up));
  }
  prev = now;
}
