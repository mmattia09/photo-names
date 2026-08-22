/**
 * Runs in the page's own world, ahead of Immich's bundle, for one reason: to
 * rewrite the bounding box of a face as it is being created.
 *
 * Immich's tagging dialog is the good part — it searches people, it creates new
 * ones — but the box it sends is the one you dragged on its canvas, and that
 * canvas is sealed inside a Svelte component. So the box drawn by quick add is
 * handed over here instead, on `documentElement.dataset.photoNamesRect`, and
 * swapped into the request on its way out. Immich keeps its dialog; the face
 * lands where it was drawn.
 */

(() => {
  const KEY = "photoNamesRect";
  const original = window.fetch;

  function pendingRect() {
    const raw = document.documentElement.dataset[KEY];
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  window.fetch = function (input, init) {
    try {
      const url = typeof input === "string" ? input : input && input.url;
      const method = (
        (init && init.method) ||
        (input && input.method) ||
        "GET"
      ).toUpperCase();

      if (method === "POST" && /\/api\/faces(\?|$)/.test(url || "")) {
        const rect = pendingRect();
        // Only a plain string body is touched; anything else is left to Immich
        // rather than guessed at.
        if (rect && init && typeof init.body === "string") {
          const body = JSON.parse(init.body);
          init = {
            ...init,
            body: JSON.stringify({
              ...body,
              imageWidth: rect.imageWidth,
              imageHeight: rect.imageHeight,
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            }),
          };
          // One box, one face: a later tag drawn by Immich stays Immich's.
          delete document.documentElement.dataset[KEY];
        }
      }
    } catch {
      // A rewrite that goes wrong must not take the request down with it.
    }

    return original.call(this, input, init);
  };
})();
