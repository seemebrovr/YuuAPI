

const colorEpsilon = 0.000001;


export class Color {
  public r: number;
  public g: number;
  public b: number;


  constructor(r: number = 0, g: number = 0, b: number = 0) {
    this.r = r;
    this.g = g;
    this.b = b;
  }

  equals(vector: Color, epsilon: number = colorEpsilon): boolean {
    return Math.abs(this.r - vector.r) < epsilon &&
      Math.abs(this.g - vector.g) < epsilon &&
      Math.abs(this.b - vector.b) < epsilon;
  }

  clone(): Color {
    return new Color(this.r, this.g, this.b);
  }

  toString(): string {
    return `Color(${this.r}, ${this.g}, ${this.b})`;
  }


  static get black(): Color { return new Color(0, 0, 0); }
  static get white(): Color { return new Color(1, 1, 1); }

  static get red(): Color { return new Color(1, 0, 0); }
  static get green(): Color { return new Color(0, 1, 0); }
  static get blue(): Color { return new Color(0, 0, 1); }

  static get cyan(): Color { return new Color(0, 1, 1); }
  static get magenta(): Color { return new Color(1, 0, 1); }
  static get yellow(): Color { return new Color(1, 1, 0); }

  static get orange(): Color { return new Color(1, 0.5, 0); }
  static get purple(): Color { return new Color(0.5, 0, 1); }
  static get pink(): Color { return new Color(1, 0.686, 0.88); }

  static randomHue(saturation: number = 1, value: number = 1): Color {
    return Color.fromHSV(Math.random(), saturation, value);
  }

  static equals(v1: Color, v2: Color, epsilon: number = colorEpsilon): boolean { return v1.equals(v2, epsilon); }
  static clone(vector: Color): Color { return vector.clone(); }
  static toString(vector: Color): string { return vector.toString(); }

  /**
 * Returns an RGB Color from an HSV Color with ranges from 0 to 1
 */
  static fromHSV(h: number, s: number, v: number) {
    let r = 0;
    let g = 0;
    let b = 0;

    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);

    switch (i % 6) {
      case 0: r = v, g = t, b = p; break;
      case 1: r = q, g = v, b = p; break;
      case 2: r = p, g = v, b = t; break;
      case 3: r = p, g = q, b = v; break;
      case 4: r = t, g = p, b = v; break;
      case 5: r = v, g = p, b = q; break;
    }

    return new Color(r, g , b);
  }
}
