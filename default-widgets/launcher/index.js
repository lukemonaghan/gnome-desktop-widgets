// Search Launcher Widget
// Quick-launch placeholder

var label;

function render(ctx, api) {
  label = new ctx.St.Label({ text: '🔍 Type to search...' });
  ctx.box.add_child(label);
}

function onClick(ctx, api) {
  api.widget.log('Launcher activated');
}
