// Copyright 2018 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {Position, Annotation} from './position'
import {BoardSize, COL_LABELS, Color, Coord, Point, Move, N, Nullable, moveIsPoint, movesEqual, otherColor, toKgs} from './base'
import {Board} from './board'
import {pixelRatio} from './util'

const STAR_POINTS = {
  [BoardSize.Nine]: [[2, 2], [2, 6], [6, 2], [6, 6], [4, 4]],
  [BoardSize.Nineteen]: [[3, 3], [3, 9], [3, 15],
                         [9, 3], [9, 9], [9, 15],
                         [15, 3], [15, 9], [15, 15]],
};

abstract class Layer {
  private _show = true;

  get show() {
    return this._show;
  }
  set show(x: boolean) {
    if (x != this._show) {
      this._show = x;
      this.board.draw();
    }
  }

  board: Board;
  protected boardToCanvas: (row: number, col: number) => Coord;

  addToBoard(board: Board) {
    this.board = board;
    this.boardToCanvas = board.boardToCanvas.bind(board);
  }

  abstract clear(): void;

  // Tell the layer that the given properties on the board's position have
  // been updated.
  // Returns true if position contained updated data for the layer and it should
  // be redrawn.
  abstract update(props: Set<string>): boolean;

  abstract draw(): void;
}

abstract class StaticLayer extends Layer {
  clear() {}

  update(props: Set<string>) {
    return false;
  }
}

class Grid extends StaticLayer {
  private style = '#864';

  draw() {
    let starPointRadius = Math.min(4, Math.max(this.board.stoneRadius / 5, 2.5));
    let ctx = this.board.ctx;
    let pr = pixelRatio();

    ctx.strokeStyle = this.style;
    ctx.lineWidth = pr;
    ctx.lineCap = 'round';

    ctx.beginPath();
    for (let i = 0; i < N; ++i) {
      let left = this.boardToCanvas(i, 0);
      let right = this.boardToCanvas(i, N - 1);
      let top = this.boardToCanvas(0, i);
      let bottom = this.boardToCanvas(N - 1, i);
      ctx.moveTo(0.5 + Math.round(left.x), 0.5 + Math.round(left.y));
      ctx.lineTo(0.5 + Math.round(right.x), 0.5 + Math.round(right.y));
      ctx.moveTo(0.5 + Math.round(top.x), 0.5 + Math.round(top.y));
      ctx.lineTo(0.5 + Math.round(bottom.x), 0.5 + Math.round(bottom.y));
    }
    ctx.stroke();

    // Draw star points.
    ctx.fillStyle = this.style;
    ctx.strokeStyle = '';
    for (let p of STAR_POINTS[N]) {
      let c = this.boardToCanvas(p[0], p[1]);
      ctx.beginPath();
      ctx.arc(c.x + 0.5, c.y + 0.5, starPointRadius * pr, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
}

class Label extends StaticLayer {
  draw() {
    let ctx = this.board.ctx;

    let textHeight = Math.floor(0.6 * this.board.stoneRadius);
    ctx.font = `${textHeight}px sans-serif`;
    ctx.fillStyle = '#9d7c4d';

    // Draw column labels.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (let i = 0; i < N; ++i) {
      let c = this.boardToCanvas(-0.66, i);
      ctx.fillText(COL_LABELS[i], c.x, c.y);
    }
    ctx.textBaseline = 'top';
    for (let i = 0; i < N; ++i) {
      let c = this.boardToCanvas(N - 0.33, i);
      ctx.fillText(COL_LABELS[i], c.x, c.y);
    }

    // Draw row labels.
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < N; ++i) {
      let c = this.boardToCanvas(i, -0.66);
      ctx.fillText((N - i).toString(), c.x, c.y);
    }
    ctx.textAlign = 'left';
    for (let i = 0; i < N; ++i) {
      let c = this.boardToCanvas(i, N - 0.33);
      ctx.fillText((N - i).toString(), c.x, c.y);
    }
  }
}

class Caption extends StaticLayer {
  constructor(public caption: string) {
    super();
  }

  draw() {
    let ctx = this.board.ctx;

    let textHeight = Math.floor(0.8 * this.board.stoneRadius);
    ctx.font = `${textHeight}px sans-serif`;
    ctx.fillStyle = '#9d7c4d';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    let c = this.boardToCanvas(N - 0.45, (N - 1) / 2);
    ctx.fillText(this.caption, c.x, c.y);
  }
}

abstract class HeatMapBase extends Layer {
  protected colors: Float32Array[] = [];

  clear() {
    if (this.colors.length > 0) {
      this.colors = [];
      this.board.draw();
    }
  }

  draw() {
    if (this.colors.length == 0) {
      return;
    }

    let ctx = this.board.ctx;
    let w = this.board.pointW;
    let h = this.board.pointH;
    let stones = this.board.stones;
    let p = {row: 0, col: 0};
    let i = 0;
    for (p.row = 0; p.row < N; ++p.row) {
      for (p.col = 0; p.col < N; ++p.col) {
        let rgba = this.colors[i];
        if (stones[i++] != Color.Empty) {
          continue;
        }
        ctx.fillStyle = `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${rgba[3]}`;
        let c = this.boardToCanvas(p.row, p.col);
        ctx.fillRect(c.x - 0.5 * w, c.y - 0.5 * h, w, h);
      }
    }
  }
}

namespace HeatMapBase {
  export const TRANSPARENT = new Float32Array([0, 0, 0, 0]);
}

class VisitCountHeatMap extends HeatMapBase {
  update(props: Set<string>) {
    if (!props.has('childN')) {
      return false;
    }

    this.colors = [];
    if (this.board.position.childN == null) {
      return true;
    }

    let n = Math.max(this.board.position.n, 1);
    for (let childN of this.board.position.childN) {
      if (childN == 0) {
        this.colors.push(HeatMapBase.TRANSPARENT);
      } else {
        let a = Math.min(Math.sqrt(childN / n), 0.6);
        if (a > 0) {
          a = 0.1 + 0.9 * a;
        }
        this.colors.push(new Float32Array([0, 0, 0, a]));
      }
    }

    return true;
  }
}

class DeltaQHeatMap extends HeatMapBase {
  update(props: Set<string>) {
    if (!props.has('childQ')) {
      return false;
    }

    let position = this.board.position;
    this.colors = [];
    if (position.childQ == null) {
      return true;
    }

    let q = position.q;
    for (let i = 0; i < N * N; ++i) {
      if (position.stones[i] != Color.Empty) {
        this.colors.push(HeatMapBase.TRANSPARENT);
      } else {
        let childQ = position.childQ[i];
        let dq = childQ - q;
        let rgb = dq > 0 ? 0 : 255;
        let a = Math.min(Math.abs(dq), 0.6);
        this.colors.push(new Float32Array([rgb, rgb, rgb, a]));
      }
    }

    return true;
  }
}


abstract class StoneBaseLayer extends Layer {
  protected blackStones: Point[] = [];
  protected whiteStones: Point[] = [];

  constructor(protected alpha: number) {
    super();
  }

  clear() {
    if (this.blackStones.length > 0 || this.whiteStones.length > 0) {
      this.blackStones = [];
      this.whiteStones = [];
      this.board.draw();
    }
  }

  draw() {
    this.board.drawStones(this.blackStones, Color.Black, this.alpha);
    this.board.drawStones(this.whiteStones, Color.White, this.alpha);
  }
}

class BoardStones extends StoneBaseLayer {
  constructor() {
    super(1);
  }

  update(props: Set<string>) {
    if (!props.has('stones')) {
      return false;
    }
    let position = this.board.position;
    this.blackStones = [];
    this.whiteStones = [];
    let i = 0;
    for (let row = 0; row < N; ++row) {
      for (let col = 0; col < N; ++col) {
        let color = position.stones[i++];
        if (color == Color.Black) {
          this.blackStones.push({row: row, col: col});
        } else if (color == Color.White) {
          this.whiteStones.push({row: row, col: col});
        }
      }
    }
    return true;
  }
}

class Variation extends StoneBaseLayer {
  get showVariation() {
    return this._showVariation;
  }
  set showVariation(x: string) {
    if (x == this._showVariation) {
      return;
    }
    this._showVariation = x;
    this.update(new Set<string>(["variations"]));
    this.draw();
  }

  private variation: Move[] = [];
  private blackLabels: Variation.Label[] = [];
  private whiteLabels: Variation.Label[] = [];

  constructor(private _showVariation: string, alpha=0.4) {
    super(alpha);
  }

  clear() {
    super.clear();
    this.variation = [];
    this.blackLabels = [];
    this.whiteLabels = [];
  }

  update(props: Set<string>) {
    if (!props.has("variations")) {
      return false;
    }

    let position = this.board.position;
    let variation = position.variations.get(this.showVariation);
    if (variation === undefined) {
      // clear() will request that Board is redrawn if necessary, so we don't
      // need to signal that anything has changed.
      this.clear();
      return false;
    }

    if (this.variationsEqual(variation, this.variation)) {
      return false;
    }

    this.variation = variation.slice(0);
    this.parseVariation(this.variation);

    return true;
  }

  private variationsEqual(a: Move[], b: Move[]) {
    if (a.length != b.length) {
      return false;
    }
    for (let i = 0; i < a.length; ++i) {
      if (!movesEqual(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }

  protected parseVariation(variation: Move[]) {
    let toPlay = this.board.position.toPlay;
    this.blackStones = [];
    this.whiteStones = [];
    this.blackLabels = [];
    this.whiteLabels = [];

    if (variation.length == 0) {
      return true;
    }

    // The playedCount array keeps track of the number of times each point on
    // the board is played within the variation. For points that are played more
    // we only show the earliest move and mark it with an asterisk.
    let playedCount = new Uint16Array(N * N);
    let firstPlayed: Variation.Label[] = [];

    toPlay = otherColor(toPlay);
    for (let i = 0; i < variation.length; ++i) {
      let move = variation[i];

      toPlay = otherColor(toPlay);
      if (move == 'pass' || move == 'resign') {
        continue;
      }

      let idx = move.row * N + move.col;
      let label = {p: move, s: (i + 1).toString()};
      let count = ++playedCount[idx];
      if (toPlay == Color.Black) {
        this.blackStones.push(move);
        if (count == 1) {
          this.blackLabels.push(label);
        }
      } else {
        this.whiteStones.push(move);
        if (count == 1) {
          this.whiteLabels.push(label);
        }
      }
      if (count == 1) {
        firstPlayed[idx] = label;
      } else if (count == 2) {
        firstPlayed[idx].s += '*';
      }
    }

    return true;
  }

  draw() {
    super.draw()

    let ctx = this.board.ctx;

    let textHeight = Math.floor(this.board.stoneRadius);
    ctx.font = `${textHeight}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    this.drawLabels(this.blackLabels, '#fff');
    this.drawLabels(this.whiteLabels, '#000');
  }

  protected drawLabels(labels: Variation.Label[], style: string) {
    let ctx = this.board.ctx;
    ctx.fillStyle = style;
    for (let label of labels) {
      let c = this.boardToCanvas(label.p.row, label.p.col);
      ctx.fillText(label.s, c.x, c.y);
    }
  }
}

namespace Variation {
  export interface Label {
    p: Point;
    s: string;
  }

  export enum Type {
    Principal,
    CurrentSearch,
    SpecificMove,
  }
}


class Annotations extends Layer {
  private annotations = new Map<Annotation.Shape, Annotation[]>();

  clear() {
    if (this.annotations.size > 0) {
      this.annotations.clear();
      this.board.draw();
    }
  }

  update(props: Set<string>) {
    if (!props.has('annotations')) {
      return false;
    }

    let position = this.board.position;
    this.annotations.clear();
    for (let annotation of position.annotations) {
      let byShape = this.annotations.get(annotation.shape);
      if (byShape === undefined) {
        byShape = [];
        this.annotations.set(annotation.shape, byShape);
      }
      byShape.push(annotation);
    }
    return true;
  }

  draw() {
    if (this.annotations.size == 0) {
      return;
    }

    let sr = this.board.stoneRadius;
    let pr = pixelRatio();

    let ctx = this.board.ctx;
    ctx.lineCap = 'round';
    this.annotations.forEach((annotations: Annotation[], shape: Annotation.Shape) => {
      switch (shape) {
        case Annotation.Shape.Dot:
          for (let annotation of annotations) {
            let c = this.boardToCanvas(annotation.p.row, annotation.p.col);
            ctx.fillStyle = annotation.colors[0];
            ctx.beginPath();
            ctx.arc(c.x + 0.5, c.y + 0.5, 0.16 * sr, 0, 2 * Math.PI);
            ctx.fill();
          }
          break;
      }
    });
  }
}

class Search extends Layer {
  // Map from move index in the range [0..N*N) to first move in the variation.
  private bestVariations = new Map<number, Search.Move>();

  hasVariation(p: Point) {
    return this.bestVariations.has(p.col + p.row * N);
  }

  clear() {
    if (this.bestVariations.size > 0) {
      this.bestVariations.clear();
      this.board.draw();
    }
  }

  update(props: Set<string>) {
    if (!props.has('childN') && !props.has('childQ')) {
      return false;
    }

    this.bestVariations.clear();

    let position = this.board.position;
    if (position.childN == null || position.childQ == null) {
      return false;
    }

    // Build a list of indices into childN & childQ sorted in descending N.
    let indices = [];
    for (let i = 0; i < N * N; ++i) {
      indices.push(i);
    }
    indices.sort((a: number, b: number) => {
      let n = position.childN as number[];
      return n[b] - n[a];
    });

    let maxN = position.childN[indices[0]];
    if (maxN == 0) {
      // We haven't done any reads yet.
      return true;
    }

    let logMaxN = Math.log(maxN);

    // Build the list of best variations.
    let idx = indices[0];
    for (let i = 0; i < indices.length; ++i) {
      let idx = indices[i];
      let n = position.childN[idx];
      if (n <= 1 || n < position.n / 100) {
        break;
      }
      this.addVariation(idx, logMaxN);
    }

    // Make sure we include all variations of the current position, no matter
    // how bad we think they are.
    for (let child of position.children) {
      if (moveIsPoint(child.lastMove) && !this.hasVariation(child.lastMove)) {
        let idx = child.lastMove.col + child.lastMove.row * N;
        this.addVariation(idx, logMaxN);
      }
    }

    return true;
  }

  draw() {
    if (this.bestVariations.size == 0) {
      return;
    }

    let ctx = this.board.ctx;
    let pr = pixelRatio();

    let stoneRgb = this.board.position.toPlay == Color.Black ? 0 : 255;
    let textRgb = 255 - stoneRgb;

    this.bestVariations.forEach((v: Search.Move) => {
      ctx.fillStyle = `rgba(${stoneRgb}, ${stoneRgb}, ${stoneRgb}, ${v.alpha})`;
      let c = this.boardToCanvas(v.p.row, v.p.col);
      ctx.beginPath();
      ctx.arc(c.x + 0.5, c.y + 0.5, this.board.stoneRadius, 0, 2 * Math.PI);
      ctx.fill();
    });

    let textHeight = Math.floor(0.8 * this.board.stoneRadius);
    ctx.font = `${textHeight}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(${textRgb}, ${textRgb}, ${textRgb}, 0.8)`;
    let scoreScale = this.board.position.toPlay == Color.Black ? 1 : -1;
    this.bestVariations.forEach((v: Search.Move) => {
      let c = this.boardToCanvas(v.p.row, v.p.col);
      let winRate = 50 + 50 * scoreScale * v.q;
      ctx.fillText(winRate.toFixed(1), c.x, c.y);
    });
  }

  private addVariation(idx: number, logMaxN: number) {
    if (this.board.position.childN == null ||
        this.board.position.childQ == null) {
      return;
    }
    let n = this.board.position.childN[idx];
    let q = this.board.position.childQ[idx];
    let alpha = Math.log(n) / logMaxN;
    alpha *= alpha;
    this.bestVariations.set(idx, new Search.Move(idx, n, q, alpha));
  }
}

namespace Search {
  // Holds data required to render the first move in a variation.
  export class Move {
    p: Point;
    constructor(idx: number, public n: number, public q: number,
                public alpha: number) {
      this.p = {
        row: Math.floor(idx / N),
        col: idx % N,
      };
    }
  }
}

export {
  Annotations,
  BoardStones,
  Caption,
  DeltaQHeatMap,
  Grid,
  Label,
  Layer,
  Search,
  Variation,
  VisitCountHeatMap,
}
