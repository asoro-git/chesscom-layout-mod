/**
 * Advanced Puzzle Engine: Snapshot-Locked Finite State Machine
 * Context: Injected Main-World Runtime Thread
 */
(() => {
  // --- 1. STATE MACHINE & LOCK CONFIGURATION ---
  let puzzleState = "calculating";
  let isAutoNextActive = false;
  let hasLoggedCurrentSnapshot = false;
  const failedData = [];

  let lastAutoActionTime = 0;
  let totalPuzzles = 0;
  let correctPuzzles = 0;
  let totalTimeSpent = 0;
  let currentPuzzleStartTime = performance.now();

  let isMinimized = false;
  let boardSize = 450;
  let horizontalOffset = (window.innerWidth / 2) * 0.1;
  let verticalOffset = (window.innerHeight / 2) * 0.3;

  let sidebarX = window.innerWidth - 390;
  let sidebarY = 80;
  let isSidebarFolded = false;
  let flipped = false;
  let hasUserDraggedSidebar = false;

  let sidebarViewMode = "all";
  let isManuallyPositioned = true;

  let userSideColor = "White";
  let geometryStyle = null;
  let lastGeometryCSS = null;
  let lastSidebarPositioned = null;
  let lastSidebarFoldedState = null;

  const clamp = (value, min, max) => {
    if (!Number.isFinite(value)) return min;
    if (max <= min) return min;
    return Math.min(Math.max(value, min), max);
  };

  const getViewportLayoutMetrics = () => {
    const viewportWidth = Math.max(window.innerWidth, 320);
    const viewportHeight = Math.max(window.innerHeight, 320);
    const compactViewport = viewportWidth <= 900 || viewportHeight <= 760;
    const shouldDockCompactSidebar =
      compactViewport && !hasUserDraggedSidebar && !isSidebarDragging;
    const edgePadding = compactViewport || viewportWidth <= 640 ? 12 : 16;
    const sidebarWidth = compactViewport
      ? viewportWidth - edgePadding * 2
      : Math.min(360, viewportWidth - edgePadding * 2);
    const sidebarHeight = compactViewport
      ? Math.min(
          Math.round(viewportHeight * 0.42),
          viewportHeight - edgePadding * 2,
          320,
        )
      : Math.min(
          Math.round(viewportHeight * 0.7),
          viewportHeight - edgePadding * 2,
        );
    const availableBoardHeight = compactViewport
      ? viewportHeight - sidebarHeight - edgePadding * 3
      : viewportHeight - edgePadding * 4;
    const availableBoardWidth = viewportWidth - edgePadding * 2;
    const maxBoardSize = Math.max(
      120,
      Math.min(availableBoardWidth, availableBoardHeight),
    );

    return {
      compactViewport,
      effectiveBoardSize: Math.min(boardSize, maxBoardSize),
      effectiveHorizontalOffset: compactViewport ? 0 : horizontalOffset,
      effectiveVerticalOffset: compactViewport ? 0 : verticalOffset,
      sidebarLeft: shouldDockCompactSidebar
        ? Math.round((viewportWidth - sidebarWidth) / 2)
        : clamp(
            sidebarX,
            edgePadding,
            viewportWidth - sidebarWidth - edgePadding,
          ),
      sidebarTop: shouldDockCompactSidebar
        ? viewportHeight - sidebarHeight - edgePadding
        : clamp(
            sidebarY,
            edgePadding,
            viewportHeight - sidebarHeight - edgePadding,
          ),
    };
  };

  const getSidebarElement = () =>
    document.getElementById("board-layout-sidebar") ||
    document.querySelector(".board-layout-sidebar");

  const handleSPANavigation = () => {
    console.log("[FSM System] SPA Page Turn Detected. Resetting memory locks.");
    puzzleState = "calculating";
    hasLoggedCurrentSnapshot = false;
    currentPuzzleStartTime = performance.now();
  };

  // Listen for standard back/forward button clicks
  window.addEventListener("popstate", handleSPANavigation);

  const originalPushState = history.pushState;
  history.pushState = function () {
    originalPushState.apply(this, arguments);
    handleSPANavigation();
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function () {
    originalReplaceState.apply(this, arguments);
    handleSPANavigation();
  };

  /**
   * Intent Enforcement Gate
   */
  const checkBoardFlip = () => {
    const chessBoard =
      document.getElementById("board-primary") ||
      document.querySelector("wc-chess-board");
    if (!chessBoard) return false;

    try {
      const gameState = chessBoard.game;
      if (!gameState || !gameState.getPlayingAs) return false;

      const sideToMove = gameState.getPlayingAs();

      const isBlackToMove = sideToMove === 2;
      const platformIsFlipped =
        chessBoard.hasAttribute("flipped") ||
        chessBoard.classList.contains("flipped");

      let needsFlipToWhite = false;
      let needsFlipToBlack = false;

      if (flipped === true) {
        needsFlipToWhite = isBlackToMove && platformIsFlipped;
        needsFlipToBlack = !isBlackToMove && !platformIsFlipped;
      } else {
        needsFlipToWhite = isBlackToMove && !platformIsFlipped;
        needsFlipToBlack = !isBlackToMove && platformIsFlipped;
      }

      if (needsFlipToBlack === true || needsFlipToWhite === true) {
        const nativeFlipBtn =
          document.querySelector(".board-controls-flip") ||
          document.getElementById("board-controls-flip") ||
          document.querySelector('[aria-label="Flip Board"]') ||
          document.querySelector('[aria-label="Flip board"]') ||
          document.querySelector(".icon-font-chess.repeat") ||
          document.querySelector(".board-layout-controls .repeat") ||
          document.querySelector(".puzzle-rush-controls .repeat");

        if (nativeFlipBtn) {
          nativeFlipBtn.click();
          updateUI();
          return true;
        }
      }
    } catch (err) {
      console.warn(
        "[FSM Core] Intercept error reading custom component proxy:",
        err,
      );
    }
    return false;
  };

  const updateSidebarViewModeAttribute = () => {
    const body = document.body;
    if (body && body.getAttribute("data-view-mode") !== sidebarViewMode) {
      body.setAttribute("data-view-mode", sidebarViewMode);
    }
    const sidebar = getSidebarElement();
    if (sidebar && sidebar.getAttribute("data-view-mode") !== sidebarViewMode) {
      sidebar.setAttribute("data-view-mode", sidebarViewMode);
    }
  };

  const relocateNativePlayersToSidebar = () => {
    const sidebar = document.getElementById("board-layout-sidebar");
    const mainContainer = document.getElementById("board-layout-main");
    const chessBoardBox = document.getElementById("board-layout-chessboard");
    const playerTop = document.getElementById("board-layout-player-top");
    const playerBottom = document.getElementById("board-layout-player-bottom");

    if (!sidebar || !mainContainer || !chessBoardBox) return;

    if (sidebarViewMode === "all") {
      if (playerTop && playerTop.parentElement !== mainContainer) {
        mainContainer.insertBefore(playerTop, chessBoardBox);
      }
      if (playerBottom && playerBottom.parentElement !== mainContainer) {
        mainContainer.insertBefore(playerBottom, chessBoardBox.nextSibling);
      }
    } else {
      if (playerTop && playerTop.parentElement !== sidebar) {
        sidebar.insertBefore(playerTop, sidebar.firstChild);
      }
      if (playerBottom && playerBottom.parentElement !== sidebar) {
        const nextTarget = playerTop
          ? playerTop.nextSibling
          : sidebar.firstChild;
        sidebar.insertBefore(playerBottom, nextTarget);
      }
    }
  };

  // --- 2. PRESENTATION LAYER (CSS GRID OVERRIDES) ---
  const injectStyles = () => {
    let style = document.getElementById("custom-engine-layouts");
    if (style) return;

    style = document.createElement("style");
    style.id = "custom-engine-layouts";
    style.innerHTML = `
      body[data-view-mode="clock"] .board-layout,
      body[data-view-mode="button-clock"] .board-layout,
      body[data-view-mode="clock"] #board-layout-main,
      body[data-view-mode="button-clock"] #board-layout-main {
        grid-template-areas: none !important;
        grid-template-columns: none !important;
        grid-template-rows: none !important;
      }

      body[data-view-mode="clock"] #board-layout-main,
      body[data-view-mode="button-clock"] #board-layout-main {
        display: flex !important;
        flex-direction: column !important;
        justify-content: center !important;
        align-items: center !important;
        position: relative !important;
        width: ${boardSize}px !important;
      }

      body[data-view-mode="clock"] #board-layout-chessboard, 
      body[data-view-mode="clock"] .board-layout-chessboard, 
      body[data-view-mode="clock"] #board-primary, 
      body[data-view-mode="clock"] wc-chess-board,
      body[data-view-mode="button-clock"] #board-layout-chessboard, 
      body[data-view-mode="button-clock"] .board-layout-chessboard, 
      body[data-view-mode="button-clock"] #board-primary, 
      body[data-view-mode="button-clock"] wc-chess-board {
        width: ${boardSize}px !important; 
        height: ${boardSize}px !important;
        transform: none !important; 
      }

      body[data-view-mode="clock"] #board-layout-player-top,
      body[data-view-mode="clock"] #board-layout-player-bottom,
      body[data-view-mode="button-clock"] #board-layout-player-top,
      body[data-view-mode="button-clock"] #board-layout-player-bottom {
        grid-area: auto !important;
        position: relative !important;
        left: auto !important;
        top: auto !important;
        width: 100% !important;
        max-width: 100% !important;
        transform: none !important;
        margin-bottom: 10px !important;
        height: auto !important;
        background: #1e1d1a !important;
        border: 1px solid #333 !important;
        border-radius: 6px !important;
        padding: 6px !important;
        box-sizing: border-box !important;
        display: block !important;
      }

      body[data-view-mode="clock"] #board-layout-sidebar, 
      body[data-view-mode="button-clock"] #board-layout-sidebar,
      body[data-view-mode="clock"] .board-layout-sidebar,
      body[data-view-mode="button-clock"] .board-layout-sidebar,
      body.sidebar-is-positioned #board-layout-sidebar,
      body.sidebar-is-positioned .board-layout-sidebar {
        --sidebarMinHeight: 0 !important;
        position: fixed !important; 
        width: min(360px, calc(100vw - 32px)) !important; 
        max-width: calc(100vw - 32px) !important;
        height: min(70vh, calc(100vh - 32px)) !important; 
        max-height: calc(100vh - 32px) !important;
        margin: 4px 0px 4px 0px !important;
        z-index: 99999 !important; 
        background: rgba(25, 25, 25, 0.96) !important; 
        border-radius: 8px !important;
        padding: 15px !important; 
        box-shadow: 0 8px 32px rgba(0,0,0,0.5) !important;
        display: flex !important; 
        flex-direction: column !important;
        overflow-y: auto !important;
      }

      body[data-view-mode="clock"] #board-layout-sidebar::-webkit-scrollbar,
      body[data-view-mode="button-clock"] #board-layout-sidebar::-webkit-scrollbar,
      body.sidebar-is-positioned #board-layout-sidebar::-webkit-scrollbar {
        width: 8px !important;
        display: block !important;
      }
      body[data-view-mode="clock"] #board-layout-sidebar::-webkit-scrollbar-thumb,
      body[data-view-mode="button-clock"] #board-layout-sidebar::-webkit-scrollbar-thumb,
      body.sidebar-is-positioned #board-layout-sidebar::-webkit-scrollbar-thumb {
        background: #444 !important;
        border-radius: 4px !important;
      }

      .board-layout-sidebar:has(.puzzle-path-container-container) {
        min-height: 70vh !important;
        min-width: 0 !important;
        width: auto !important;
        max-width: calc(100vw - 32px) !important;
        height: 70vh !important;
        max-height: 85vh !important;
      }

      body[data-view-mode="button-clock"] #board-layout-sidebar .game-controls-controller-component,
      body[data-view-mode="button-clock"] .board-layout-sidebar .game-controls-controller-component {
        position: sticky !important;
        bottom: -15px !important;
        padding: 0 !important;
        background: #191919 !important; 
        z-index: 1000 !important;
      }

      #board-layout-sidebar[data-view-mode="clock"] > :not(#board-layout-player-top):not(#board-layout-player-bottom) { display: none !important; }
      #board-layout-sidebar[data-view-mode="button-clock"] > :not(#board-layout-player-top):not(#board-layout-player-bottom):not(.game-controls-controller-component):not(:has(.game-controls-controller-component)) { display: none !important; }
      
      #board-layout-sidebar[data-view-mode="button-clock"] .select-themes-container-component,
      #board-layout-sidebar[data-view-mode="button-clock"] .learning-sidebar-start-cta-section,
      #board-layout-sidebar[data-view-mode="button-clock"] .rated-sidebar-component,
      #board-layout-sidebar[data-view-mode="button-clock"] .learning-filters-component,
      #board-layout-sidebar[data-view-mode="button-clock"] .bot-speech-multiple-messages-component,
      #board-layout-sidebar[data-view-mode="button-clock"] .bot-speech-multiple-messages-withPadding,
      #board-layout-sidebar[data-view-mode="button-clock"] .play-controller-messages,
      #board-layout-sidebar[data-view-mode="button-clock"] .cc-sidebar-header-header-center,
      #board-layout-sidebar[data-view-mode="button-clock"] .cc-sidebar-header-component,
      #board-layout-sidebar[data-view-mode="button-clock"] .cc-sidebar-header-secondary { display: none !important; }

      #board-layout-sidebar, .board-layout-sidebar { user-select: none !important; cursor: move; }
      .primary-controls-topControls { margin-top: 0 !important; }
      .rated-sidebar-component { display: block !important; }
      .select-themes-container-component { max-height: 35vh !important; overflow-y: auto !important; padding-right: 5px !important; border: 1px solid rgba(255,255,255,0.05) !important; background: rgba(0,0,0,0.2) !important; border-radius: 4px !important; margin-bottom: 10px !important; }
      .select-themes-container-component::-webkit-scrollbar { width: 6px !important; }
      .select-themes-container-component::-webkit-scrollbar-thumb { background: #444 !important; border-radius: 3px !important; }
      .learning-sidebar-start-cta-section { display: block !important; width: 100% !important; margin-top: auto !important; visibility: visible !important; opacity: 1 !important; }
      .learning-sidebar-start-button, [data-cy="start-button"] { display: flex !important; width: 100% !important; min-height: 48px !important; visibility: visible !important; opacity: 1 !important; }
      .board-layout-main-2, #board-layout-main-2 { display: none !important; }
      
      #custom-draggable-panel { opacity: 0.15; transform: scale(0.98); transform-origin: top left; transition: opacity 0.2s ease-in-out, transform 0.2s ease-in-out; }
      #custom-draggable-panel:hover { opacity: 1 !important; transform: scale(1) !important; background-color: rgba(20, 20, 20, 0.98) !important; }
      body[data-sidebar-folded="true"] #board-layout-sidebar, body[data-sidebar-folded="true"] .board-layout-sidebar { display: none !important; }

      @media (max-width: 900px), (max-height: 760px) {
        body[data-view-mode="clock"] #board-layout-sidebar,
        body[data-view-mode="button-clock"] #board-layout-sidebar,
        body[data-view-mode="clock"] .board-layout-sidebar,
        body[data-view-mode="button-clock"] .board-layout-sidebar,
        body.sidebar-is-positioned #board-layout-sidebar,
        body.sidebar-is-positioned .board-layout-sidebar,
        .board-layout-sidebar:has(.puzzle-path-container-container) {
          width: calc(100vw - 24px) !important;
          min-width: 0 !important;
          max-width: calc(100vw - 24px) !important;
          height: min(42vh, 320px) !important;
          min-height: 0 !important;
          max-height: calc(100vh - 24px) !important;
          padding: 12px !important;
        }
      }
    `;
    document.head.appendChild(style);
  };

  const updateDynamicGeometry = () => {
    if (!document.body) return;
    const {
      effectiveBoardSize,
      effectiveHorizontalOffset,
      effectiveVerticalOffset,
      sidebarLeft,
      sidebarTop,
    } = getViewportLayoutMetrics();

    if (!geometryStyle) {
      geometryStyle = document.getElementById("custom-board-geometry");
    }
    if (!geometryStyle) {
      geometryStyle = document.createElement("style");
      geometryStyle.id = "custom-board-geometry";
      document.head.appendChild(geometryStyle);
    }

    const hasMapPath =
      document.querySelector(".puzzle-path-container-container") !== null;
    const shouldPositionSidebar =
      sidebarViewMode !== "all" || isManuallyPositioned || hasMapPath;

    if (lastSidebarPositioned !== shouldPositionSidebar) {
      document.body.classList.toggle(
        "sidebar-is-positioned",
        shouldPositionSidebar,
      );
      lastSidebarPositioned = shouldPositionSidebar;
    }

    const nextGeometryCSS = shouldPositionSidebar
      ? `
        #board-layout-main {
          width: ${effectiveBoardSize}px !important;
          transform: translate(${effectiveHorizontalOffset}px, ${effectiveVerticalOffset}px) !important;
        }
        #board-layout-chessboard, .board-layout-chessboard, #board-primary, wc-chess-board {
          width: ${effectiveBoardSize}px !important;
          height: ${effectiveBoardSize}px !important;
          max-width: none !important;
          max-height: none !important;
          transform: none !important;
        }
        .evaluation-bar-bar, [class*="evaluation-bar-bar"] {
          height: ${effectiveBoardSize}px !important;
          max-height: ${effectiveBoardSize}px !important;
        }
        #board-layout-sidebar, .board-layout-sidebar {
          position: fixed !important;
          left: ${sidebarLeft}px !important; 
          top: ${sidebarTop}px !important; 
          right: auto !important;
          bottom: auto !important;
        }
      `
      : "";

    if (lastGeometryCSS !== nextGeometryCSS) {
      geometryStyle.textContent = nextGeometryCSS;
      lastGeometryCSS = nextGeometryCSS;
    }

    const nextFoldedState = isSidebarFolded ? "true" : "false";
    if (lastSidebarFoldedState !== nextFoldedState) {
      document.body.setAttribute("data-sidebar-folded", nextFoldedState);
      lastSidebarFoldedState = nextFoldedState;
    }
  };

  // --- 3. DRAGGABLE HUD CANVAS HANDLERS ---
  const overlay = document.createElement("div");
  overlay.id = "custom-draggable-panel";
  Object.assign(overlay.style, {
    position: "fixed",
    top: "15px",
    left: "15px",
    width: "280px",
    maxHeight: "85vh",
    overflowY: "auto",
    padding: "14px",
    backgroundColor: "rgba(20, 20, 20, 0.15)",
    color: "#eee",
    fontFamily: "monospace",
    fontSize: "12px",
    borderRadius: "8px",
    zIndex: "10005",
    border: "1px solid #444",
    boxShadow: "0 8px 32px rgba(0,0,0,0.8)",
    cursor: "move",
    userSelect: "none",
  });
  document.body.appendChild(overlay);

  let isPanelDragging = false;
  let isSidebarDragging = false;
  let pStartX, pStartY, pInitialLeft, pInitialTop;
  let sStartX, sStartY, sInitialLeft, sInitialTop, sWidth, sHeight;
  let pendingSidebarX = sidebarX;
  let pendingSidebarY = sidebarY;
  let activeSidebarDragElement = null;
  let sidebarDragFrame = 0;
  let sidebarDragPreviousTransform = "";
  let sidebarDragPreviousWillChange = "";

  const flushSidebarDragPosition = () => {
    sidebarDragFrame = 0;
    if (!isSidebarDragging || !activeSidebarDragElement) return;

    const deltaX = pendingSidebarX - sInitialLeft;
    const deltaY = pendingSidebarY - sInitialTop;
    activeSidebarDragElement.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
  };

  const scheduleSidebarDragPosition = () => {
    if (sidebarDragFrame) return;
    sidebarDragFrame = requestAnimationFrame(flushSidebarDragPosition);
  };

  const commitSidebarDragPosition = () => {
    if (sidebarDragFrame) {
      cancelAnimationFrame(sidebarDragFrame);
      sidebarDragFrame = 0;
    }
    if (!activeSidebarDragElement) return;

    sidebarX = pendingSidebarX;
    sidebarY = pendingSidebarY;
    activeSidebarDragElement.style.transform = sidebarDragPreviousTransform;
    activeSidebarDragElement.style.willChange = sidebarDragPreviousWillChange;
    activeSidebarDragElement = null;
    updateDynamicGeometry();
  };

  overlay.addEventListener(
    "mousedown",
    (e) => {
      if (["INPUT", "BUTTON", "LABEL", "A", "SPAN"].includes(e.target.tagName))
        return;
      isPanelDragging = true;
      pStartX = e.clientX;
      pStartY = e.clientY;
      pInitialLeft = parseFloat(overlay.style.left) || 15;
      pInitialTop = parseFloat(overlay.style.top) || 15;
      overlay.style.transition = "none";
      e.preventDefault();
    },
    { capture: true, passive: false },
  );

  const configureSidebarDragListeners = () => {
    const sidebar = getSidebarElement();
    if (!sidebar || sidebar.dataset.dragConfigured === "true") return;
    sidebar.dataset.dragConfigured = "true";

    sidebar.addEventListener(
      "mousedown",
      (e) => {
        if (
          [
            "INPUT",
            "BUTTON",
            "SELECT",
            "LABEL",
            "A",
            "SVG",
            "PATH",
            "SPAN",
            "CANVAS",
          ].includes(e.target.tagName)
        )
          return;
        if (
          e.target.closest(".select-themes-container-component") ||
          e.target.closest(".learning-filters-component")
        )
          return;

        isSidebarDragging = true;
        isManuallyPositioned = true;
        hasUserDraggedSidebar = true;
        activeSidebarDragElement = sidebar;
        sidebarDragPreviousTransform = sidebar.style.transform;
        sidebarDragPreviousWillChange = sidebar.style.willChange;

        const rect = sidebar.getBoundingClientRect();
        sStartX = e.clientX;
        sStartY = e.clientY;
        sInitialLeft = rect.left;
        sInitialTop = rect.top;
        sWidth = rect.width;
        sHeight = rect.height;

        pendingSidebarX = sInitialLeft;
        pendingSidebarY = sInitialTop;
        sidebarX = sInitialLeft;
        sidebarY = sInitialTop;
        sidebar.style.willChange = "transform";
        sidebar.style.transform = "translate3d(0, 0, 0)";
        updateDynamicGeometry();

        e.preventDefault();
        e.stopPropagation();
      },
      { capture: true, passive: false },
    );
  };

  document.addEventListener(
    "mousemove",
    (e) => {
      if (isPanelDragging) {
        overlay.style.left = `${pInitialLeft + (e.clientX - pStartX)}px`;
        overlay.style.top = `${pInitialTop + (e.clientY - pStartY)}px`;
        e.preventDefault();
        e.stopPropagation();
      }
      if (isSidebarDragging) {
        const viewportWidth = Math.max(window.innerWidth, 320);
        const viewportHeight = Math.max(window.innerHeight, 320);
        const compactViewport = viewportWidth <= 900 || viewportHeight <= 760;
        const edgePadding = compactViewport || viewportWidth <= 640 ? 12 : 16;
        const maxSidebarX = viewportWidth - sWidth - edgePadding;
        const maxSidebarY = viewportHeight - sHeight - edgePadding;

        pendingSidebarX = clamp(
          sInitialLeft + (e.clientX - sStartX),
          edgePadding,
          maxSidebarX,
        );
        pendingSidebarY = clamp(
          sInitialTop + (e.clientY - sStartY),
          edgePadding,
          maxSidebarY,
        );
        scheduleSidebarDragPosition();
        e.preventDefault();
        e.stopPropagation();
      }
    },
    { capture: true, passive: false },
  );

  document.addEventListener(
    "mouseup",
    (e) => {
      if (isSidebarDragging) {
        commitSidebarDragPosition();
      }
      if (isPanelDragging || isSidebarDragging) {
        isPanelDragging = false;
        isSidebarDragging = false;
        overlay.style.transition =
          "opacity 0.2s ease-in-out, transform 0.2s ease-in-out";
        e.preventDefault();
        e.stopPropagation();
      }
    },
    { capture: true, passive: false },
  );

  const flipChessBoard = () => {
    const nativeFlipBtn =
      document.querySelector(".board-controls-flip") ||
      document.getElementById("board-controls-flip") ||
      document.querySelector('[aria-label="Flip Board"]') ||
      document.querySelector('[aria-label="Flip board"]') ||
      document.querySelector(".icon-font-chess.repeat") ||
      document.querySelector(".board-layout-controls .repeat") ||
      document.querySelector(".puzzle-rush-controls .repeat");

    if (nativeFlipBtn) nativeFlipBtn.click();
  };

  // --- 4. HUD METRICS RENDERING ---
  const updateUI = () => {
    const correctRate =
      totalPuzzles > 0
        ? ((correctPuzzles / totalPuzzles) * 100).toFixed(1)
        : "0.0";
    const avgTime =
      totalPuzzles > 0 ? (totalTimeSpent / totalPuzzles).toFixed(1) : "0.0";
    const foldLabel = isSidebarFolded ? "☼ Unfold Sidebar" : "✕ Fold Sidebar";
    const flipLabel = flipped ? "Defense Training" : "Attack Training";

    const hasMapPath =
      document.querySelector(".puzzle-path-container-container") !== null;

    let viewModeLabel = "Show All";
    if (!hasMapPath) {
      if (sidebarViewMode === "clock") viewModeLabel = "Only Clocks";
      if (sidebarViewMode === "button-clock")
        viewModeLabel = "Clocks + Buttons";
    } else {
      sidebarViewMode = "all";
    }

    const liveBoard =
      document.querySelector("wc-chess-board") ||
      document.getElementById("board-primary");
    if (liveBoard?.game?.getPlayingAs) {
      let sideCode = liveBoard.game.getPlayingAs();
      if (sideCode === 2) userSideColor = "Black";
      if (sideCode === 1) userSideColor = "White";
    }

    if (isMinimized) {
      overlay.style.width = "190px";
      overlay.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; font-weight: bold; border-bottom: 1px solid #333; padding-bottom: 4px; margin-bottom: 6px; color: #60a5fa;">
          MINI METRICS
          <span id="btn-toggle-view" style="cursor: pointer; background: #333; padding: 1px 6px; border-radius: 3px; color: #fff; font-size: 10px;">▢ Maximize</span>
        </div>
        <div style="font-size: 11px; line-height: 1.5;">
          Playing As: ${userSideColor}<br>
          Accuracy: <strong style="color: #10b981; font-size: 13px;">${correctRate}%</strong><br>
          Avg Time: <strong style="color: #fbbf24; font-size: 13px;">${avgTime}s</strong>
        </div>
        <button id="btn-toggle-sidebar-mini" style="width: 100%; background: #222; color: #aaa; border: 1px solid #444; padding: 3px; border-radius: 4px; cursor: pointer; font-size: 10px; font-family: monospace; margin-top:4px;">
          ${isSidebarFolded ? "Unfold Sidebar" : "Fold Sidebar"}
        </button>
        <button id="btn-toggle-flipped" style="width: 100%; background: #222; color: #aaa; border: 1px solid #444; padding: 3px; border-radius: 4px; cursor: pointer; font-size: 10px; font-family: monospace; margin-top:2px;">
          ${flipLabel}
        </button>
      `;
      document.getElementById("btn-toggle-sidebar-mini").onclick = (e) => {
        e.stopPropagation();
        isSidebarFolded = !isSidebarFolded;
        updateDynamicGeometry();
        updateUI();
      };
      document.getElementById("btn-toggle-flipped").onclick = (e) => {
        e.stopPropagation();
        flipped = !flipped;
        flipChessBoard();
        updateUI();
      };
    } else {
      overlay.style.width = "280px";
      overlay.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; font-weight: bold; border-bottom: 1px solid #333; padding-bottom: 5px; margin-bottom: 10px; color:#aaa;">
          ⚙ CONTROL HUB
          <span id="btn-toggle-view" style="cursor: pointer; background: #333; padding: 1px 6px; border-radius: 3px; color: #fff; font-size: 10px;">– Minimize</span>
        </div>
        <div style="margin-bottom: 10px; font-weight: bold; display: flex; flex-direction: column; gap: 4px;">
          <div>AUTO-RUN ENGINE: <span style="color: ${isAutoNextActive ? "#4caf50" : "#f44336"}">${isAutoNextActive ? "ACTIVE" : "DISABLED"}</span> (Space)</div>
          <div>Playing As: ${userSideColor}</div>
          <div style="color: #888; font-size: 11px;">PRESS 'F' TO SHOW HINT</div>
          <div style="display: flex; gap: 4px; margin-top: 4px;">
            <button id="btn-toggle-sidebar-main" style="flex: 1; background: #2b3a60; color: white; border: none; padding: 5px; border-radius: 4px; cursor: pointer; font-size: 11px; font-family: monospace; font-weight: bold;">${foldLabel}</button>
            <button id="btn-toggle-flipped" style="flex: 1; background: #2b3a60; color: white; border: none; padding: 5px; border-radius: 4px; cursor: pointer; font-size: 11px; font-family: monospace; font-weight: bold;">${flipLabel}</button>
          </div>
          ${
            !hasMapPath
              ? `
          <button id="btn-cycle-view-mode" style="width: 100%; background: #2b3a60; color: white; border: none; padding: 6px; border-radius: 4px; cursor: pointer; font-size: 11px; font-family: monospace; font-weight: bold; margin-top: 4px;">
              Sidebar: ${viewModeLabel}
          </button>`
              : ""
          }
        </div>
        <div style="background: #1a233a; padding: 10px; border-radius: 6px; margin-bottom: 10px; border: 1px solid #2b3a60;">
          <div style="font-weight: bold; margin-bottom: 6px; color: #60a5fa;">SESSION ANALYTICS</div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;"><span>Puzzles Played:</span> <strong>${totalPuzzles}</strong></div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;"><span>Correct Rate:</span> <strong style="color: #10b981;">${correctRate}%</strong></div>
          <div style="display: flex; justify-content: space-between;"><span>Avg Pace:</span> <strong style="color: #fbbf24;">${avgTime}s</strong></div>
        </div>
        <div style="background: #222; padding: 10px; border-radius: 6px; margin-bottom: 10px; border: 1px solid #333;">
          <div style="font-weight: bold; margin-bottom: 6px; color: #3b82f6;">LAYOUT CONFIG</div>
          <label style="display:block; margin-bottom: 4px;">Scale Size: <span id="val-size">${boardSize}px</span></label>
          <input type="range" id="slide-size" min="300" max="800" value="${boardSize}" style="width:100%; margin-bottom:10px; cursor:pointer;">
          <label style="display:block; margin-bottom: 4px;">X-Offset: <span id="val-xoffset">${horizontalOffset}px</span></label>
          <input type="range" id="slide-xoffset" min="-300" max="300" value="${horizontalOffset}" style="width:100%; margin-bottom:10px; cursor:pointer;">
          <label style="display:block; margin-bottom: 4px;">Y-Offset: <span id="val-yoffset">${verticalOffset}px</span></label>
          <input type="range" id="slide-offset" min="-200" max="200" value="${verticalOffset}" style="width:100%; cursor:pointer;">
        </div>
        <div style="margin-bottom: 12px; color:#aaa;">Export PGN: <strong>(coming soon)</strong></div>
        <button id="copy-urls-btn" style="width: 100%; background: #3b82f6; color: white; border: none; padding: 8px; border-radius: 4px; cursor: pointer; font-weight: bold;">Export (Coming soon)</button>
      `;

      document.getElementById("slide-size").oninput = (e) => {
        boardSize = e.target.value;
        document.getElementById("val-size").innerText = boardSize + "px";
        updateDynamicGeometry();
        window.dispatchEvent(new Event("resize"));
      };
      document.getElementById("slide-xoffset").oninput = (e) => {
        horizontalOffset = e.target.value;
        document.getElementById("val-xoffset").innerText =
          horizontalOffset + "px";
        updateDynamicGeometry();
      };
      document.getElementById("slide-offset").oninput = (e) => {
        verticalOffset = e.target.value;
        document.getElementById("val-yoffset").innerText =
          verticalOffset + "px";
        updateDynamicGeometry();
      };
      document.getElementById("copy-urls-btn").onclick = () =>
        navigator.clipboard.writeText(failedData.map((d) => d.url).join("\n"));

      document.getElementById("btn-toggle-sidebar-main").onclick = (e) => {
        e.stopPropagation();
        isSidebarFolded = !isSidebarFolded;
        updateDynamicGeometry();
        updateUI();
      };
      document.getElementById("btn-toggle-flipped").onclick = (e) => {
        e.stopPropagation();
        flipped = !flipped;
        flipChessBoard();
        updateUI();
      };

      const cycleBtn = document.getElementById("btn-cycle-view-mode");
      if (cycleBtn) {
        cycleBtn.onclick = (e) => {
          e.stopPropagation();
          if (sidebarViewMode === "all") sidebarViewMode = "clock";
          else if (sidebarViewMode === "clock")
            sidebarViewMode = "button-clock";
          else sidebarViewMode = "all";
          updateSidebarViewModeAttribute();
          updateDynamicGeometry();
          updateUI();
        };
      }
    }

    document.getElementById("btn-toggle-view").onclick = (e) => {
      e.stopPropagation();
      isMinimized = !isMinimized;
      updateUI();
    };
  };

  // --- 5. FINITE STATE MACHINE RUNTIME TICKER ---
  const stateMachineEngineTick = () => {
    const isEnabled =
      document.body.getAttribute("data-engine-enabled") !== "false";
    const customLayouts = document.getElementById("custom-engine-layouts");
    const customGeo = document.getElementById("custom-board-geometry");

    if (!isEnabled) {
      if (overlay) overlay.style.display = "none";
      if (customLayouts) customLayouts.disabled = true;
      if (customGeo) customGeo.disabled = true;
      return;
    } else {
      if (overlay) overlay.style.display = "block";
      if (customLayouts) customLayouts.disabled = false;
      if (customGeo) customGeo.disabled = false;
    }

    updateSidebarViewModeAttribute();
    updateDynamicGeometry();
    relocateNativePlayersToSidebar();
    configureSidebarDragListeners();

    if (checkBoardFlip()) return;

    let nextBtn =
      document.querySelector('[data-cy="next-puzzle-button"]') ||
      document.querySelector(".puzzle-path-next-button") ||
      document.querySelector(
        '.ui_v5-button-component.primary:not([data-cy="submit-move"])',
      );

    let retryBtn =
      document.querySelector('[data-cy="retry-move-button"]') ||
      document.querySelector(".puzzle-path-retry-button");

    const isNextEnabled =
      nextBtn &&
      !nextBtn.hasAttribute("disabled") &&
      !nextBtn.classList.contains("disabled");

    if (!isNextEnabled && !retryBtn) {
      if (puzzleState !== "calculating") {
        puzzleState = "calculating";
        hasLoggedCurrentSnapshot = false;
        currentPuzzleStartTime = performance.now();
      }
      return;
    }

    let hasVisualLossIndicator =
      document.getElementById("incorrect") !== null ||
      document.querySelector('.effect [id="incorrect"]') !== null;

    if (!hasLoggedCurrentSnapshot) {
      if (!hasVisualLossIndicator) {
        puzzleState = "passed";
        hasLoggedCurrentSnapshot = true;
        totalPuzzles++;
        correctPuzzles++;
        totalTimeSpent += Math.round(
          (performance.now() - currentPuzzleStartTime) / 1000,
        );
        updateUI();
      } else if (hasVisualLossIndicator) {
        puzzleState = "failed";
        hasLoggedCurrentSnapshot = true;
        totalPuzzles++;
        totalTimeSpent += Math.round(
          (performance.now() - currentPuzzleStartTime) / 1000,
        );

        const problemPath = window.location.pathname;
        if (!failedData.some((item) => item.id === problemPath)) {
          failedData.push({
            id: problemPath,
            url: window.location.origin + problemPath,
          });
        }
        updateUI();
      }
    }

    if (isAutoNextActive) {
      if (performance.now() - lastAutoActionTime > 1200) {
        if (puzzleState === "passed" && isNextEnabled && nextBtn) {
          nextBtn.click();
          lastAutoActionTime = performance.now();
        } else if (puzzleState === "failed" && retryBtn) {
          retryBtn.click();
          lastAutoActionTime = performance.now();
        }
      }
    }
  };

  // --- 6. INITIALIZATION SHORTCUT HEADERS ---
  window.addEventListener(
    "keydown",
    (e) => {
      if (document.body.getAttribute("data-engine-enabled") === "false") return;
      if (["INPUT", "TEXTAREA"].includes(document.activeElement.tagName))
        return;
      if (e.code === "Space") {
        e.preventDefault();
        e.stopImmediatePropagation();
        isAutoNextActive = !isAutoNextActive;
        updateUI();
      }
      if (e.code === "KeyF") {
        e.preventDefault();
        e.stopImmediatePropagation();
        document.querySelector('[data-cy="hint-move-button"]')?.click();
      }
    },
    true,
  );

  injectStyles();
  updateDynamicGeometry();
  updateUI();

  setInterval(stateMachineEngineTick, 100);
})();
