// jsdom 30 implements <dialog> as an element but not its modal methods, so a
// component calling `showModal()` throws on mount and takes the whole suite
// with it. Both bottom sheets and the search overlay are built on it — they
// use the platform's focus trap, inertness and Escape handling rather than
// reimplementing them — so without this stub none of them can be rendered in a
// test at all.
//
// What this does NOT do is simulate modality. The focus trap, the inertness of
// the page behind, and the top layer are the browser's behaviour, not ours, and
// they remain verifiable only in a real one. This stub exists so the logic
// around the dialog — what it renders, what it calls, when it closes — can be
// tested; treating a green run here as proof the trap works would be the wrong
// lesson.
//
// The `open` attribute is set alongside, because jsdom applies the UA rule that
// hides a dialog without it, and queries would then find nothing.
if (typeof HTMLDialogElement !== "undefined") {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
  }

  if (!HTMLDialogElement.prototype.show) {
    HTMLDialogElement.prototype.show = function show(this: HTMLDialogElement) {
      this.open = true;
    };
  }

  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.open = false;
    };
  }
}
