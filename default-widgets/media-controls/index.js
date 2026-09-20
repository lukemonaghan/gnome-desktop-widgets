// Media Controls Widget
// Simple play/pause toggle with display

var label;
var playing = false;

function getText() {
  var icon = playing ? '⏸️' : '▶️';
  var state = playing ? 'Playing' : 'Paused';
  return icon + ' ' + state + '\n⏮️ Prev  ⏭️ Next';
}

function render(ctx, api) {
  label = new ctx.St.Label({ text: getText() });
  ctx.box.add_child(label);
}

function onClick(ctx, api) {
  playing = !playing;
  label.set_text(getText());
}
