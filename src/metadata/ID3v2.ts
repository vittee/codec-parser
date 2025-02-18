/* Copyright 2020-2021 Ethan Halsall
    
    This file is part of codec-parser.
    
    codec-parser is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    codec-parser is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>
*/

import { ICodecParser } from "../CodecParser";
import { HeaderCache } from "../codecs/HeaderCache";
import { RawHeader } from "../types";

// https://id3.org/Developer%20Information

type ID3v2Header = RawHeader & {
  version: string;
  unsynchronizationFlag: boolean;
  extendedHeaderFlag: boolean;
  experimentalFlag: boolean;
  footerPresent: boolean;
  headerLength: 10;
  dataLength: number;
}

export function *getID3v2Header(codecParser: ICodecParser, _headerCache: HeaderCache, readOffset: number): Generator<Uint8Array, ID3v2 | undefined, Uint8Array> {
  const header = { headerLength: 10 } as ID3v2Header;

  let data = yield* codecParser.readRawData(3, readOffset);
  // Byte (0-2 of 9)
  // ID3
  if (data[0] !== 0x49 || data[1] !== 0x44 || data[2] !== 0x33) return;

  data = yield* codecParser.readRawData(header.headerLength, readOffset);

  // Byte (3-4 of 9)
  // * `BBBBBBBB|........`: Major version
  // * `........|BBBBBBBB`: Minor version
  header.version = `id3v2.${data[3]}.${data[4]}`;

  // Byte (5 of 9)
  // * `....0000.: Zeros (flags not implemented yet)
  if (data[5] & 0b00001111) return;

  // Byte (5 of 9)
  // * `CDEF0000`: Flags
  // * `C.......`: Unsynchronisation (indicates whether or not unsynchronisation is used)
  // * `.D......`: Extended header (indicates whether or not the header is followed by an extended header)
  // * `..E.....`: Experimental indicator (indicates whether or not the tag is in an experimental stage)
  // * `...F....`: Footer present (indicates that a footer is present at the very end of the tag)
  header.unsynchronizationFlag = Boolean(data[5] & 0b10000000);
  header.extendedHeaderFlag = Boolean(data[5] & 0b01000000);
  header.experimentalFlag = Boolean(data[5] & 0b00100000);
  header.footerPresent = Boolean(data[5] & 0b00010000);

  // Byte (6-9 of 9)
  // * `0.......|0.......|0.......|0.......`: Zeros
  if (
    data[6] & 0b10000000 ||
    data[7] & 0b10000000 ||
    data[8] & 0b10000000 ||
    data[9] & 0b10000000
  )
    return;

  // Byte (6-9 of 9)
  // * `.FFFFFFF|.FFFFFFF|.FFFFFFF|.FFFFFFF`: Tag Length
  // The ID3v2 tag size is encoded with four bytes where the most significant bit (bit 7)
  // is set to zero in every byte, making a total of 28 bits. The zeroed bits are ignored,
  // so a 257 bytes long tag is represented as $00 00 02 01.
  header.dataLength =
    (data[6] << 21) | (data[7] << 14) | (data[8] << 7) | data[9];

  header.length = header.headerLength + header.dataLength;

  return new ID3v2(header);
}

export class ID3v2 {

  constructor(header: ID3v2Header) {
    this.version = header.version;
    this.unsynchronizationFlag = header.unsynchronizationFlag;
    this.extendedHeaderFlag = header.extendedHeaderFlag;
    this.experimentalFlag = header.experimentalFlag;
    this.footerPresent = header.footerPresent;
    this.length = header.length;
  }

  readonly version: string;
  readonly unsynchronizationFlag: boolean;
  readonly extendedHeaderFlag: boolean;
  readonly experimentalFlag: boolean;
  readonly footerPresent: boolean;
  readonly length: number;
}
