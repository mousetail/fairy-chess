export type Random = {
  next(): number;
  // Clone the RNG which should generate the same sequence of random numbers
  clone(): Random;
}

export class Xoshiro128ss implements Random {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(a: number, b: number, c: number, d: number) {
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
  }

  next(): number {
    const t = this.b << 9
    const v = this.b * 5;
    const r = (v << 7 | v >>> 25) * 9;
    this.c ^= this.a;
    this.d ^= this.b;
    this.b ^= this.c;
    this.a ^= this.d;
    this.c ^= t;
    this.d = this.d << 11 | this.d >>> 21;
    return (r >>> 0) / 4294967296;
  }

  clone(): Random {
    return new Xoshiro128ss(this.a, this.b, this.c, this.d);
  }
}
