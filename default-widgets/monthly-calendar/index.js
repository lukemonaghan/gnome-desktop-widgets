// Monthly Calendar Widget
// Renders a text-based calendar grid for the current month

var label;

function getText() {
  var now = new Date();
  var year = now.getFullYear();
  var month = now.getMonth();
  var today = now.getDate();
  var monthName = now.toLocaleString('default', { month: 'long' });
  var header = monthName + ' ' + year;
  var dayLabels = 'Su Mo Tu We Th Fr Sa';
  var firstDay = new Date(year, month, 1).getDay();
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var grid = '';
  var col = 0;

  for (var i = 0; i < firstDay; i++) {
    grid += '   ';
    col++;
  }
  for (var d = 1; d <= daysInMonth; d++) {
    if (d === today) {
      grid += '[' + String(d).padStart(2);
    } else {
      grid += ' ' + String(d).padStart(2);
    }
    col++;
    if (col === 7) {
      grid += '\n';
      col = 0;
    }
  }
  return header + '\n' + dayLabels + '\n' + grid.trimEnd();
}

function render(ctx, api) {
  // Monospace keeps the day columns lined up
  label = new ctx.St.Label({ text: getText(), style: 'font-family: monospace;' });
  ctx.box.add_child(label);
}

function update(ctx, api) {
  label.set_text(getText());
}
