import { createHash } from 'node:crypto';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function sha256(data: Buffer): Buffer {
  return createHash('sha256').update(data).digest();
}

function base58Encode(buffer: Buffer): string {
  let num = BigInt('0x' + buffer.toString('hex'));
  let result = '';

  while (num > 0n) {
    const remainder = Number(num % 58n);
    num = num / 58n;
    result = ALPHABET[remainder] + result;
  }

  for (const byte of buffer) {
    if (byte === 0) {
      result = ALPHABET[0] + result;
    } else {
      break;
    }
  }

  return result;
}

function base58Decode(str: string): Buffer {
  let num = 0n;
  for (const char of str) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Invalid base58 character: ${char}`);
    num = num * 58n + BigInt(index);
  }

  let hex = num.toString(16);
  if (hex.length % 2) hex = '0' + hex;

  let leadingZeros = 0;
  for (const char of str) {
    if (char === ALPHABET[0]) leadingZeros++;
    else break;
  }

  return Buffer.concat([Buffer.alloc(leadingZeros), Buffer.from(hex, 'hex')]);
}

export const TronAddress = {
  fromEvmAddress(evmAddress: string): string {
    const addressHex = evmAddress.replace('0x', '').toLowerCase();
    const addressBytes = Buffer.from('41' + addressHex, 'hex');
    const hash = sha256(sha256(addressBytes));
    const checksum = hash.subarray(0, 4);
    const addressWithChecksum = Buffer.concat([addressBytes, checksum]);
    return base58Encode(addressWithChecksum);
  },

  toEvmAddress(tronAddress: string): string {
    const decoded = base58Decode(tronAddress);
    const addressBytes = decoded.subarray(0, decoded.length - 4);
    const hex = addressBytes.toString('hex').slice(2); // strip 0x41 prefix
    return '0x' + hex;
  },

  isValid(address: string): boolean {
    if (!address.startsWith('T') || address.length !== 34) return false;

    try {
      const decoded = base58Decode(address);
      if (decoded.length !== 25) return false;

      const addressBytes = decoded.subarray(0, 21);
      const checksum = decoded.subarray(21, 25);
      const hash = sha256(sha256(addressBytes));
      return hash.subarray(0, 4).equals(checksum);
    } catch {
      return false;
    }
  },
};
