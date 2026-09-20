// System Monitor Widget
// Shows live CPU and memory usage from the system poller

var label;

function getText(cpu, mem) {
  var cpuPct = cpu != null ? Math.round(cpu) : '--';
  var memPct = mem != null ? Math.round(mem.usedPercent) : '--';
  var memUsedMB = mem != null ? Math.round(mem.used / 1024) : '--';
  var memTotalMB = mem != null ? Math.round(mem.total / 1024) : '--';
  return 'CPU: ' + cpuPct + '%\nMEM: ' + memPct + '% (' + memUsedMB + '/' + memTotalMB + ' MB)';
}

function render(ctx, api) {
  label = new ctx.St.Label({ text: getText(null, null) });
  ctx.box.add_child(label);
}

function update(ctx, api) {
  var cpu = api.system.cpu();
  var mem = api.system.memory();
  label.set_text(getText(cpu, mem));
}
