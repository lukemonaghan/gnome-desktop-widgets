// Weather Summary Widget
// Displays a weather summary (placeholder — replace with real API integration)

var label;

function render(ctx, api) {
  label = new ctx.St.Label({ text: '☀️ Sunny 24°C\nFeels like 26°C\nHumidity: 45%' });
  ctx.box.add_child(label);
}

function update(ctx, api) {
  // Placeholder: would call api.network.fetchJSON() with a weather API
  label.set_text('☀️ Sunny 24°C\nFeels like 26°C\nHumidity: 45%');
}
