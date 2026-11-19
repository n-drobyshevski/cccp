/* The open dialog, sheet and command dialog examples mount dialogIsland, which calls showModal():
   right for an app, where the app asked for that dialog to be open. The gallery shows every open
   example at once, though, and each modal dialog makes the rest of the page inert and takes focus,
   so the last one would hold the page and the filter could not be reached. Inside a gallery card a
   dialog is shown in place instead (show(): open, not modal); the card's transform keeps a fixed
   sheet inside the card. A dialog outside the cards keeps its modal behaviour. */

/**
 * Patch a dialog prototype so showModal() on a dialog inside a gallery card opens it in place.
 * Safe to run twice. Returns false when there is nothing to patch.
 * @param {any} proto HTMLDialogElement.prototype (tests pass a fake)
 * @param {string} [cardSelector]
 * @returns {boolean}
 */
export function showDialogsInPlace(proto, cardSelector = "[data-gallery-card]") {
  if (!proto || typeof proto.showModal !== "function" || typeof proto.show !== "function") return false;
  if (proto.showModal.galleryInPlace) return true;
  const modal = proto.showModal;
  /** @this {any} */
  function inPlace() {
    if (this && typeof this.closest === "function" && this.closest(cardSelector)) return this.show();
    return modal.call(this);
  }
  inPlace.galleryInPlace = true;
  proto.showModal = inPlace;
  return true;
}
