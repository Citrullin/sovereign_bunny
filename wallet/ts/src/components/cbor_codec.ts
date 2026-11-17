/**
 * Native CBOR Codec for Sovereign Account-Lattice
 * Encodes and decodes structured payloads:
 * - Cross-chain blind notes & commitments
 * - W3C DID Documents & Verifiable Credentials
 * - Zanzibar ReBAC relational tuples
 * - Account CAR slot metadata
 */

export class CborCodec {
    /**
     * Encodes a JS/TS value into a standard binary CBOR Uint8Array
     */
    static encode(value: any): Uint8Array {
        const parts: Uint8Array[] = [];

        function writeTypeAndLength(major: number, length: number | bigint): void {
            const num = typeof length === 'bigint' ? length : BigInt(length);
            if (num < 24n) {
                parts.push(new Uint8Array([(major << 5) | Number(num)]));
            } else if (num <= 0xffn) {
                parts.push(new Uint8Array([(major << 5) | 24, Number(num)]));
            } else if (num <= 0xffffn) {
                const n = Number(num);
                parts.push(new Uint8Array([(major << 5) | 25, (n >> 8) & 0xff, n & 0xff]));
            } else if (num <= 0xffffffffn) {
                const n = Number(num);
                parts.push(new Uint8Array([
                    (major << 5) | 26,
                    (n >>> 24) & 0xff,
                    (n >>> 16) & 0xff,
                    (n >>> 8) & 0xff,
                    n & 0xff
                ]));
            } else {
                const b = new Uint8Array(9);
                b[0] = (major << 5) | 27;
                for (let i = 0; i < 8; i++) {
                    b[8 - i] = Number((num >> BigInt(i * 8)) & 0xffn);
                }
                parts.push(b);
            }
        }

        function encodeVal(val: any): void {
            if (val === null) {
                parts.push(new Uint8Array([0xf6])); // major 7, 22
                return;
            }
            if (val === undefined) {
                parts.push(new Uint8Array([0xf7])); // major 7, 23
                return;
            }
            if (typeof val === 'boolean') {
                parts.push(new Uint8Array([val ? 0xf5 : 0xf4]));
                return;
            }
            if (typeof val === 'number') {
                if (Number.isInteger(val)) {
                    if (val >= 0) {
                        writeTypeAndLength(0, val);
                    } else {
                        writeTypeAndLength(1, -1 - val);
                    }
                } else {
                    // 64-bit float
                    const buf = new ArrayBuffer(9);
                    const view = new DataView(buf);
                    view.setUint8(0, 0xfb);
                    view.setFloat64(1, val, false);
                    parts.push(new Uint8Array(buf));
                }
                return;
            }
            if (typeof val === 'bigint') {
                if (val >= 0n) {
                    writeTypeAndLength(0, val);
                } else {
                    writeTypeAndLength(1, -1n - val);
                }
                return;
            }
            if (typeof val === 'string') {
                // If it's a 0x hex string, check if caller intended binary bytes
                const encoder = new TextEncoder();
                const utf8 = encoder.encode(val);
                writeTypeAndLength(3, utf8.length);
                parts.push(utf8);
                return;
            }
            if (val instanceof Uint8Array) {
                writeTypeAndLength(2, val.length);
                parts.push(val);
                return;
            }
            if (Array.isArray(val)) {
                writeTypeAndLength(4, val.length);
                for (const item of val) {
                    encodeVal(item);
                }
                return;
            }
            if (typeof val === 'object') {
                const keys = Object.keys(val);
                writeTypeAndLength(5, keys.length);
                for (const k of keys) {
                    encodeVal(k);
                    encodeVal(val[k]);
                }
                return;
            }
            throw new Error(`Unsupported value for CBOR encoding: ${typeof val}`);
        }

        encodeVal(value);

        // Concatenate all parts
        const totalLen = parts.reduce((acc, p) => acc + p.length, 0);
        const result = new Uint8Array(totalLen);
        let offset = 0;
        for (const p of parts) {
            result.set(p, offset);
            offset += p.length;
        }
        return result;
    }

    /**
     * Decodes binary CBOR Uint8Array or 0x hex string into structured JS/TS object
     */
    static decode(bufferOrHex: string | Uint8Array): any {
        let bytes: Uint8Array;
        if (typeof bufferOrHex === "string") {
            const cleanHex = bufferOrHex.startsWith("0x") ? bufferOrHex.slice(2) : bufferOrHex;
            const match = cleanHex.match(/.{1,2}/g);
            bytes = match ? new Uint8Array(match.map(byte => parseInt(byte, 16))) : new Uint8Array();
        } else if (bufferOrHex instanceof Uint8Array) {
            bytes = bufferOrHex;
        } else {
            throw new Error("Invalid CBOR input type");
        }

        let offset = 0;

        function read(count: number): Uint8Array {
            if (offset + count > bytes.length) throw new Error("Unexpected end of CBOR buffer");
            const slice = bytes.subarray(offset, offset + count);
            offset += count;
            return slice;
        }

        function readUint8(): number {
            return read(1)[0];
        }

        function readLength(info: number): number {
            if (info < 24) return info;
            if (info === 24) return readUint8();
            if (info === 25) {
                const b = read(2);
                return (b[0] << 8) | b[1];
            }
            if (info === 26) {
                const b = read(4);
                return (b[0] * 0x1000000) + ((b[1] << 16) | (b[2] << 8) | b[3]);
            }
            if (info === 27) {
                const b = read(8);
                let val = 0n;
                for (let i = 0; i < 8; i++) {
                    val = (val << 8n) | BigInt(b[i]);
                }
                return Number(val);
            }
            throw new Error(`Unsupported CBOR additional info: ${info}`);
        }

        function decodeItem(): any {
            const initial = readUint8();
            const major = initial >> 5;
            const info = initial & 0x1f;

            switch (major) {
                case 0:
                    return readLength(info);
                case 1:
                    return -1 - readLength(info);
                case 2: {
                    const len = readLength(info);
                    const raw = read(len);
                    return "0x" + Array.from(raw).map(b => b.toString(16).padStart(2, '0')).join('');
                }
                case 3: {
                    const len = readLength(info);
                    const raw = read(len);
                    return new TextDecoder("utf-8").decode(raw);
                }
                case 4: {
                    const len = readLength(info);
                    const arr: any[] = [];
                    for (let i = 0; i < len; i++) {
                        arr.push(decodeItem());
                    }
                    return arr;
                }
                case 5: {
                    const len = readLength(info);
                    const obj: Record<string, any> = {};
                    for (let i = 0; i < len; i++) {
                        const key = decodeItem();
                        const val = decodeItem();
                        obj[String(key)] = val;
                    }
                    return obj;
                }
                case 6: {
                    readLength(info);
                    return decodeItem();
                }
                case 7: {
                    if (info === 20) return false;
                    if (info === 21) return true;
                    if (info === 22) return null;
                    if (info === 23) return undefined;
                    if (info === 27) {
                        const b = read(8);
                        const view = new DataView(b.buffer, b.byteOffset, 8);
                        return view.getFloat64(0, false);
                    }
                    return null;
                }
                default:
                    throw new Error(`Unknown CBOR major type: ${major}`);
            }
        }

        return decodeItem();
    }

    /**
     * Converts a typed object directly to 0x-prefixed CBOR hex string
     */
    static toHex(value: any): `0x${string}` {
        const encoded = CborCodec.encode(value);
        return `0x${Array.from(encoded).map(b => b.toString(16).padStart(2, '0')).join('')}` as `0x${string}`;
    }
}
