import Phaser from "phaser";

/**
 * Elements
 * 0 Wood, 1 Fire, 2 Earth, 3 Metal, 4 Water
 */
const E = { WOOD: 0, FIRE: 1, EARTH: 2, METAL: 3, WATER: 4 };
const elementName = (e) => ["Wood", "Fire", "Earth", "Metal", "Water"][e];

// Sheng (child): Wood->Fire->Earth->Metal->Water->Wood
const childOf = [E.FIRE, E.EARTH, E.METAL, E.WATER, E.WOOD];

// Ke (controls): Wood->Earth, Fire->Metal, Earth->Water, Metal->Wood, Water->Fire
const keTarget = [E.EARTH, E.METAL, E.WATER, E.WOOD, E.FIRE];

function randElem() {
  return Math.floor(Math.random() * 5);
}

// Slightly “fair” random: avoid generating the exact same element too many times
function randElemFair(lastFew) {
  const counts = new Array(5).fill(0);
  lastFew.forEach((x) => counts[x]++);
  const weights = counts.map((c) => Math.max(0.15, 1 - c * 0.25));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < 5; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return randElem();
}

function colorFor(elem) {
  switch (elem) {
    case E.WOOD: return 0x2ecc71; // green
    case E.FIRE: return 0xe74c3c; // red
    case E.EARTH: return 0xf1c40f; // yellow
    case E.METAL: return 0xecf0f1; // silver/white
    case E.WATER: return 0x2c3e50; // dark navy
    default: return 0xffffff;
  }
}

class Bubble {
  constructor(scene, x, y, elem, level = 1) {
    this.scene = scene;
    this.elem = elem;
    this.level = level;

    this.r = scene.cellSize * 0.38;

    this.container = scene.add.container(x, y);
    this.circle = scene.add.circle(0, 0, this.r, colorFor(elem));
    this.ring = scene.add.circle(0, 0, this.r + 2).setStrokeStyle(2, 0x000000, 0.25);

    this.label = scene.add.text(0, 0, String(this.level), {
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
      fontSize: `${Math.floor(scene.cellSize * 0.28)}px`,
      color: "#0b1020"
    }).setOrigin(0.5);

    this.container.add([this.ring, this.circle, this.label]);
    this.refresh();
  }

  setPos(x, y) { this.container.setPosition(x, y); }
  destroy() { this.container.destroy(); }

  refresh() {
    this.circle.setFillStyle(colorFor(this.elem));
    this.label.setText(String(this.level));
    if (this.elem === E.WATER) this.label.setColor("#ffffff");
    else this.label.setColor("#0b1020");
  }

  grow() {
    this.level = Math.min(3, this.level + 1);
    this.refresh();
    this.scene.tweens.add({
      targets: this.container,
      scale: 1.12,
      duration: 90,
      yoyo: true,
      ease: "Quad.easeOut"
    });
  }
}

class MainScene extends Phaser.Scene {
  constructor() {
    super("main");
  }

  create() {
    /**
     * IMPORTANT: fixed virtual size (stable across iPhone Safari changes)
     * We scale the camera to fit the real canvas size.
     */
    this.vw = 390;
    this.vh = 844;

    // Layout proportional to virtual height (prevents UI being cut off on iPhone)
    this.topUIH = Math.floor(this.vh * 0.14);     // ~118
    this.bottomUIH = Math.floor(this.vh * 0.18);  // ~152

    this.playArea = {
      x: 0,
      y: this.topUIH,
      w: this.vw,
      h: this.vh - this.topUIH - this.bottomUIH
    };

    // Grid settings (square grid MVP)
    this.cols = 9;
    this.rows = 12;

    // cellSize MUST fit both width and height
    const cellW = Math.floor(this.playArea.w / this.cols);
    const cellH = Math.floor(this.playArea.h / this.rows);
    this.cellSize = Math.min(cellW, cellH);

    this.gridW = this.cellSize * this.cols;
    this.gridH = this.cellSize * this.rows;

    this.gridOrigin = {
      x: (this.vw - this.gridW) / 2,
      y: this.playArea.y + (this.playArea.h - this.gridH) / 2
    };

    this.dangerRow = this.rows - 1;

    // Respond to Phaser scale resize events
    this.scale.on("resize", () => this.onResize());

    // Background panels
    this.add.rectangle(this.vw / 2, this.topUIH / 2, this.vw, this.topUIH, 0x121a33, 0.95);
    this.add.rectangle(this.vw / 2, this.vh - this.bottomUIH / 2, this.vw, this.bottomUIH, 0x121a33, 0.95);

    // Board outline
    this.add.rectangle(
      this.gridOrigin.x + this.gridW / 2,
      this.gridOrigin.y + this.gridH / 2,
      this.gridW + 8,
      this.gridH + 8,
      0x0f1630,
      0.9
    ).setStrokeStyle(2, 0xffffff, 0.08);

    // Grid array
    this.grid = Array.from({ length: this.rows }, () => Array(this.cols).fill(null));

    // UI: Score / Status
    this.score = 0;
    this.scoreText = this.add.text(16, 16, "Score: 0", this.uiTextStyle(18));
    this.tipText = this.add.text(16, 44, "Ke removes • Sheng grows", this.uiTextStyle(14)).setAlpha(0.9);

    // Hint text near shooter
    this.hintText = this.add.text(140, this.vh - 112, "", this.uiTextStyle(14)).setAlpha(0.95);

    // Shooter position (inside bottom UI)
    this.shooterPos = { x: this.vw / 2, y: this.vh - Math.floor(this.bottomUIH * 0.42) };

    // Aim line
    this.aimLine = this.add.graphics();

    // Next queue + Hold
    this.queue = [randElem(), randElem(), randElem()];
    this.hold = null;
    this.current = this.drawFromQueue();
    this.swapUsedThisShot = false;

    this.createQueueUI();

    // Current bubble at shooter
    this.currentBubbleDisplay = new Bubble(this, this.shooterPos.x, this.shooterPos.y, this.current, 1);

    // Shot state
    this.shot = null;
    this.shotSpeed = 900;
    this.isAiming = false;

    // Input
    this.input.on("pointerdown", (p) => {
      if (this.shot) return;
      this.isAiming = true;
      this.updateAim(p);
    });

    this.input.on("pointermove", (p) => {
      if (!this.isAiming || this.shot) return;
      this.updateAim(p);
    });

    this.input.on("pointerup", (p) => {
      if (!this.isAiming || this.shot) return;
      this.isAiming = false;
      this.fireShot(p);
    });

    // Desktop swap (Shift)
    this.input.keyboard?.on("keydown-SHIFT", () => this.swapHold());

    // Mobile swap button (bottom-right)
    const swapY = this.vh - Math.floor(this.bottomUIH * 0.35);
    this.holdBtn = this.add.rectangle(this.vw - 62, swapY, 110, 48, 0x22305a, 0.95)
      .setStrokeStyle(2, 0xffffff, 0.12)
      .setInteractive({ useHandCursor: true });

    this.add.text(this.vw - 62, swapY, "SWAP", this.uiTextStyle(14)).setOrigin(0.5);
    this.holdBtn.on("pointerdown", () => this.swapHold());

    // Seed board
    this.seedBoard(4);

    // Pressure timer
    this.pressureEveryMs = 9000;
    this.pressureEvent = this.time.addEvent({
      delay: this.pressureEveryMs,
      loop: true,
      callback: () => this.applyPressure()
    });

    this.setHint(null);
    this.onResize();
  }

  uiTextStyle(sizePx) {
    return {
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
      fontSize: `${sizePx}px`,
      color: "#ffffff"
    };
  }

  onResize() {
    // Fit virtual (vw x vh) into real canvas, center it
    const w = this.scale.width;
    const h = this.scale.height;

    const scale = Math.min(w / this.vw, h / this.vh);
    const offsetX = (w - this.vw * scale) / 2;
    const offsetY = (h - this.vh * scale) / 2;

    this.cameras.main.setZoom(scale);
    this.cameras.main.setScroll(-offsetX / scale, -offsetY / scale);
  }

  // Queue / Hold
  drawFromQueue() {
    const lastFew = this.queue.slice(-2);
    const next = this.queue.shift();
    this.queue.push(randElemFair([next, ...lastFew]));
    return next;
  }

  createQueueUI() {
    const baseX = 58;
    const baseY = 70;

    this.add.text(16, 16 + 70, "Hold", this.uiTextStyle(12)).setAlpha(0.85);
    this.holdDisplay = new Bubble(this, baseX, baseY, E.WOOD, 1);
    this.holdDisplay.circle.setFillStyle(0x444444);
    this.holdDisplay.label.setText("").setAlpha(0.0);

    this.add.text(16, 16 + 110, "Next", this.uiTextStyle(12)).setAlpha(0.85);
    this.nextDisplays = [];
    for (let i = 0; i < 3; i++) {
      const b = new Bubble(this, baseX + i * 46, baseY + 52, this.queue[i], 1);
      b.label.setText("").setAlpha(0.0);
      this.nextDisplays.push(b);
    }

    this.legendText = this.add.text(
      this.vw - 16,
      16,
      "Wood green • Fire red • Earth yellow • Metal white • Water navy",
      this.uiTextStyle(11)
    ).setOrigin(1, 0).setAlpha(0.75);
  }

  refreshQueueUI() {
    if (this.hold === null) this.holdDisplay.circle.setFillStyle(0x444444);
    else this.holdDisplay.circle.setFillStyle(colorFor(this.hold));

    for (let i = 0; i < 3; i++) {
      this.nextDisplays[i].circle.setFillStyle(colorFor(this.queue[i]));
    }
  }

  swapHold() {
    if (this.shot) return;
    if (this.swapUsedThisShot) return; // once per shot

    if (this.hold === null) {
      this.hold = this.current;
      this.current = this.drawFromQueue();
    } else {
      const tmp = this.current;
      this.current = this.hold;
      this.hold = tmp;
    }

    this.swapUsedThisShot = true;
    this.currentBubbleDisplay.elem = this.current;
    this.currentBubbleDisplay.refresh();
    this.refreshQueueUI();
    this.setHint(null);
  }

  // Board helpers
  cellToWorld(r, c) {
    return {
      x: this.gridOrigin.x + c * this.cellSize + this.cellSize / 2,
      y: this.gridOrigin.y + r * this.cellSize + this.cellSize / 2
    };
  }

  worldToCell(x, y) {
    const cx = Math.floor((x - this.gridOrigin.x) / this.cellSize);
    const cy = Math.floor((y - this.gridOrigin.y) / this.cellSize);
    return { r: cy, c: cx };
  }

  inBounds(r, c) {
    return r >= 0 && r < this.rows && c >= 0 && c < this.cols;
  }

  neighbors4(r, c) {
    return [
      { r: r - 1, c },
      { r: r + 1, c },
      { r, c: c - 1 },
      { r, c: c + 1 }
    ].filter((p) => this.inBounds(p.r, p.c));
  }

  seedBoard(numRows) {
    for (let r = 0; r < numRows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (Math.random() < 0.85) {
          const elem = randElem();
          const pos = this.cellToWorld(r, c);
          this.grid[r][c] = new Bubble(this, pos.x, pos.y, elem, 1);
        }
      }
    }
  }

  applyPressure() {
    // If bottom row occupied -> game over
    for (let c = 0; c < this.cols; c++) {
      if (this.grid[this.rows - 1][c]) {
        this.gameOver("Overwhelmed by pressure 😵");
        return;
      }
    }

    // Shift down
    for (let r = this.rows - 1; r >= 1; r--) {
      for (let c = 0; c < this.cols; c++) {
        this.grid[r][c] = this.grid[r - 1][c];
        if (this.grid[r][c]) {
          const pos = this.cellToWorld(r, c);
          this.grid[r][c].setPos(pos.x, pos.y);
        }
      }
    }

    // New top row
    for (let c = 0; c < this.cols; c++) {
      if (Math.random() < 0.8) {
        const elem = randElem();
        const pos = this.cellToWorld(0, c);
        this.grid[0][c] = new Bubble(this, pos.x, pos.y, elem, 1);
      } else {
        this.grid[0][c] = null;
      }
    }

    this.cameras.main.shake(80, 0.003);
  }

  // Aiming + shooting
  updateAim(pointer) {
    const p = this.toVirtual(pointer.x, pointer.y);
    const dx = p.x - this.shooterPos.x;
    const dy = p.y - this.shooterPos.y;

    const minAngle = Phaser.Math.DegToRad(-160);
    const maxAngle = Phaser.Math.DegToRad(-20);
    let angle = Math.atan2(dy, dx);
    angle = Phaser.Math.Clamp(angle, minAngle, maxAngle);

    this.aimAngle = angle;
    this.drawAimLine(angle);

    const predicted = this.predictFirstHit(angle);
    if (predicted) this.setHint(predicted.elem);
    else this.setHint(null);
  }

  drawAimLine(angle) {
    this.aimLine.clear();
    this.aimLine.lineStyle(2, 0xffffff, 0.25);

    const len = 520;
    const x2 = this.shooterPos.x + Math.cos(angle) * len;
    const y2 = this.shooterPos.y + Math.sin(angle) * len;

    this.aimLine.beginPath();
    this.aimLine.moveTo(this.shooterPos.x, this.shooterPos.y);
    this.aimLine.lineTo(x2, y2);
    this.aimLine.strokePath();
  }

  setHint(targetElemOrNull) {
    if (targetElemOrNull === null || targetElemOrNull === undefined) {
      this.hintText.setText("");
      return;
    }
    if (targetElemOrNull === keTarget[this.current]) {
      this.hintText.setText(`KE → remove ${elementName(targetElemOrNull)}`);
    } else if (targetElemOrNull === childOf[this.current]) {
      this.hintText.setText(`Careful: SHENG → grows ${elementName(targetElemOrNull)}`);
    } else {
      this.hintText.setText(`Hit → stick (${elementName(targetElemOrNull)})`);
    }
  }

  fireShot() {
    if (this.shot) return;

    const angle = this.aimAngle ?? Phaser.Math.DegToRad(-90);

    this.shot = new Bubble(this, this.shooterPos.x, this.shooterPos.y, this.current, 1);
    this.shotVel = {
      x: Math.cos(angle) * this.shotSpeed,
      y: Math.sin(angle) * this.shotSpeed
    };

    this.currentBubbleDisplay.container.setAlpha(0.25);
    this.swapUsedThisShot = true;
    this.aimLine.clear();
  }

  toVirtual(screenX, screenY) {
    const cam = this.cameras.main;
    const worldPoint = cam.getWorldPoint(screenX, screenY);
    return { x: worldPoint.x, y: worldPoint.y };
  }

  predictFirstHit(angle) {
    const step = this.cellSize * 0.35;
    const maxSteps = 80;
    let x = this.shooterPos.x;
    let y = this.shooterPos.y;

    for (let i = 0; i < maxSteps; i++) {
      x += Math.cos(angle) * step;
      y += Math.sin(angle) * step;

      if (y < this.gridOrigin.y) return null;
      if (x < this.gridOrigin.x || x > this.gridOrigin.x + this.gridW) return null;

      const { r, c } = this.worldToCell(x, y);
      if (!this.inBounds(r, c)) continue;
      const b = this.grid[r][c];
      if (b) return b;
    }
    return null;
  }

  update(_, delta) {
    if (!this.shot) return;

    const dt = delta / 1000;
    const nextX = this.shot.container.x + this.shotVel.x * dt;
    const nextY = this.shot.container.y + this.shotVel.y * dt;

    const leftWall = this.gridOrigin.x + this.cellSize * 0.1;
    const rightWall = this.gridOrigin.x + this.gridW - this.cellSize * 0.1;

    let x = nextX;
    let y = nextY;

    if (x < leftWall) { x = leftWall; this.shotVel.x *= -1; }
    else if (x > rightWall) { x = rightWall; this.shotVel.x *= -1; }

    this.shot.setPos(x, y);

    if (y <= this.gridOrigin.y + this.cellSize * 0.5) {
      this.resolveShotPlacement();
      return;
    }

    const hit = this.findOverlapBubble(this.shot.container.x, this.shot.container.y);
    if (hit) this.resolveShotPlacement(hit);
  }

  findOverlapBubble(x, y) {
    const { r, c } = this.worldToCell(x, y);
    if (!this.inBounds(r, c)) return null;

    const candidates = [];
    for (let rr = r - 1; rr <= r + 1; rr++) {
      for (let cc = c - 1; cc <= c + 1; cc++) {
        if (!this.inBounds(rr, cc)) continue;
        const b = this.grid[rr][cc];
        if (b) candidates.push({ b, rr, cc });
      }
    }

    const threshold = this.cellSize * 0.42;
    for (const it of candidates) {
      const dx = it.b.container.x - x;
      const dy = it.b.container.y - y;
      if (Math.hypot(dx, dy) <= threshold) return it;
    }
    return null;
  }

  resolveShotPlacement(hitInfo = null) {
    let landing = null;

    if (hitInfo) {
      landing = this.findBestAdjacentEmpty(hitInfo.rr, hitInfo.cc, this.shot.container.x, this.shot.container.y);
      if (!landing) {
        const neigh = this.neighbors4(hitInfo.rr, hitInfo.cc).filter(p => !this.grid[p.r][p.c]);
        landing = neigh[0] ?? null;
      }
    }

    if (!landing) {
      const { r, c } = this.worldToCell(this.shot.container.x, this.shot.container.y);
      const rr = Phaser.Math.Clamp(r, 0, this.rows - 1);
      const cc = Phaser.Math.Clamp(c, 0, this.cols - 1);

      if (!this.grid[rr][cc]) landing = { r: rr, c: cc };
      else landing = this.findNearestEmpty(rr, cc) ?? { r: rr, c: cc };
    }

    const landedPos = this.cellToWorld(landing.r, landing.c);

    if (hitInfo) {
      const target = hitInfo.b;
      const attackerElem = this.shot.elem;
      const targetElem = target.elem;

      if (targetElem === keTarget[attackerElem]) {
        this.removeBubbleAt(hitInfo.rr, hitInfo.cc);
        this.addScore(10);
        this.shot.destroy();
        this.shot = null;
        this.afterShotResolved();
        return;
      }

      if (targetElem === childOf[attackerElem]) {
        target.grow();
        this.addScore(3);
        this.shot.destroy();
        this.shot = null;
        this.afterShotResolved();
        return;
      }
    }

    if (this.grid[landing.r][landing.c]) this.grid[landing.r][landing.c].destroy();
    this.grid[landing.r][landing.c] = this.shot;
    this.shot.setPos(landedPos.x, landedPos.y);
    this.shot = null;

    if (landing.r >= this.dangerRow) {
      this.gameOver("Hit the danger line 😭");
      return;
    }

    this.addScore(1);
    this.afterShotResolved();
  }

  findBestAdjacentEmpty(r, c, shotX, shotY) {
    const neigh = this.neighbors4(r, c).filter(p => !this.grid[p.r][p.c]);
    if (!neigh.length) return null;

    let best = null;
    let bestD = Infinity;
    for (const p of neigh) {
      const pos = this.cellToWorld(p.r, p.c);
      const d = Math.hypot(pos.x - shotX, pos.y - shotY);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  findNearestEmpty(r, c) {
    for (let radius = 1; radius < this.cols; radius++) {
      for (let dc = -radius; dc <= radius; dc++) {
        const cc = c + dc;
        if (!this.inBounds(r, cc)) continue;
        if (!this.grid[r][cc]) return { r, c: cc };
      }
    }
    return null;
  }

  removeBubbleAt(r, c) {
    const b = this.grid[r][c];
    if (!b) return;
    b.destroy();
    this.grid[r][c] = null;
  }

  addScore(v) {
    this.score += v;
    this.scoreText.setText(`Score: ${this.score}`);
  }

  afterShotResolved() {
    this.current = this.drawFromQueue();
    this.currentBubbleDisplay.elem = this.current;
    this.currentBubbleDisplay.refresh();
    this.currentBubbleDisplay.container.setAlpha(1);

    this.swapUsedThisShot = false;
    this.refreshQueueUI();
    this.setHint(null);
  }

  gameOver(message) {
    this.pressureEvent?.remove(false);
    this.input.enabled = false;

    this.add.rectangle(this.vw / 2, this.vh / 2, this.vw * 0.92, 180, 0x000000, 0.55)
      .setStrokeStyle(2, 0xffffff, 0.18);

    this.add.text(this.vw / 2, this.vh / 2 - 40, "GAME OVER", this.uiTextStyle(28)).setOrigin(0.5);
    this.add.text(this.vw / 2, this.vh / 2 - 6, message, this.uiTextStyle(16)).setOrigin(0.5).setAlpha(0.9);
    this.add.text(this.vw / 2, this.vh / 2 + 32, `Score: ${this.score}`, this.uiTextStyle(18)).setOrigin(0.5);
    this.add.text(this.vw / 2, this.vh / 2 + 74, "Refresh to try again 😏", this.uiTextStyle(14))
      .setOrigin(0.5)
      .setAlpha(0.8);
  }
}

const config = {
  type: Phaser.AUTO,
  parent: "app",
  backgroundColor: "#0b1020",
  scale: {
    mode: Phaser.Scale.RESIZE,
    parent: "app",
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 390,
    height: 844
  },
  scene: [MainScene]
};

const game = new Phaser.Game(config);

/**
 * iPhone Safari fix:
 * Use #app's real bounding box (not window.innerHeight) and force Phaser resize.
 */
function resizeToApp() {
  const app = document.getElementById("app");
  if (!app || !game.scale) return;

  const rect = app.getBoundingClientRect();
  const w = Math.floor(rect.width);
  const h = Math.floor(rect.height);

  if (w > 0 && h > 0) {
    game.scale.resize(w, h);
  }
}

// Run after layout settles (iOS needs this)
setTimeout(resizeToApp, 50);
setTimeout(resizeToApp, 250);

// Respond to address bar / orientation changes
window.addEventListener("resize", () => setTimeout(resizeToApp, 50));
window.addEventListener("orientationchange", () => setTimeout(resizeToApp, 100));
