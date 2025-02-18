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

/*

1  1) [packet_type] : 8 bit value
2  2) 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73: the characters ’v’,’o’,’r’,’b’,’i’,’s’ as six octets

Letter bits Description
A      8    Packet type
B      48   Magic signature (vorbis)
C      32   Version number
D      8    Channels
E      32   Sample rate
F      32   Bitrate Maximum (signed)
G      32   Bitrate Nominal (signed)
H      32   Bitrate Minimum (signed)
I      4    blocksize 1
J      4    blocksize 0
K      1    Framing flag
*/

import { vorbisOpusChannelMapping } from "../../constants";
import { bytesToString } from "../../utilities";

import { CodecHeader, RawCodecHeader } from "../CodecHeader";
import { HeaderCache } from "../HeaderCache";

const blockSizes: Record<number, number> = {
  // 0b0110: 64,
  // 0b0111: 128,
  // 0b1000: 256,
  // 0b1001: 512,
  // 0b1010: 1024,
  // 0b1011: 2048,
  // 0b1100: 4096,
  // 0b1101: 8192
};

for (let i = 0; i < 8; i++) blockSizes[i + 6] = 2 ** (6 + i);

export type RawVorbisHeader = RawCodecHeader & {
  data: Uint8Array;
  version: number;
  bitrateMaximum: number;
  bitrateNominal: number;
  bitrateMinimum: number;
  blocksize1: number;
  blocksize0: number;
}

export function getHeaderFromUint8Array(data: Uint8Array, headerCache: HeaderCache) {
  // Must be at least 30 bytes.
  if (data.length < 30)
    throw new Error("Out of data while inside an Ogg Page");

  // Check header cache
  const key = bytesToString(data.subarray(0, 30));
  const cachedHeader = headerCache.getHeader(key);
  if (cachedHeader) return new VorbisHeader(cachedHeader);

  const header = { length: 30 } as RawVorbisHeader;

  // Bytes (1-7 of 30): /01vorbis - Magic Signature
  if (key.substring(0, 7) !== "\x01vorbis") {
    return null;
  }

  header.data = Uint8Array.from(data.subarray(0, 30));
  const view = new DataView(header.data.buffer);

  // Byte (8-11 of 30)
  // * `CCCCCCCC|CCCCCCCC|CCCCCCCC|CCCCCCCC`: Version number
  header.version = view.getUint32(7, true);
  if (header.version !== 0) return null;

  // Byte (12 of 30)
  // * `DDDDDDDD`: Channel Count
  header.channels = data[11];
  header.channelMode =
    vorbisOpusChannelMapping[header.channels - 1] || "application defined";

  // Byte (13-16 of 30)
  // * `EEEEEEEE|EEEEEEEE|EEEEEEEE|EEEEEEEE`: Sample Rate
  header.sampleRate = view.getUint32(12, true);

  // Byte (17-20 of 30)
  // * `FFFFFFFF|FFFFFFFF|FFFFFFFF|FFFFFFFF`: Bitrate Maximum
  header.bitrateMaximum = view.getInt32(16, true);

  // Byte (21-24 of 30)
  // * `GGGGGGGG|GGGGGGGG|GGGGGGGG|GGGGGGGG`: Bitrate Nominal
  header.bitrateNominal = view.getInt32(20, true);

  // Byte (25-28 of 30)
  // * `HHHHHHHH|HHHHHHHH|HHHHHHHH|HHHHHHHH`: Bitrate Minimum
  header.bitrateMinimum = view.getInt32(24, true);

  // Byte (29 of 30)
  // * `IIII....` Blocksize 1
  // * `....JJJJ` Blocksize 0
  header.blocksize1 = blockSizes[(data[28] & 0b11110000) >> 4];
  header.blocksize0 = blockSizes[data[28] & 0b00001111];
  if (header.blocksize0 > header.blocksize1) return null;

  // Byte (29 of 30)
  // * `00000001` Framing bit
  if (data[29] !== 0x01) return null;

  header.bitDepth = 32;

  {
    // set header cache
    const { length, data, version, ...codecUpdateFields } = header;
    headerCache.setHeader(key, header, codecUpdateFields);
  }

  return new VorbisHeader(header);
}

export class VorbisHeader extends CodecHeader {
  bitrateMaximum: number;
  bitrateMinimum: number;
  bitrateNominal: number;
  blocksize0: number;
  blocksize1: number;
  data: Uint8Array;
  vorbisComments: Uint8Array;
  vorbisSetup: Uint8Array;


  /**
   * @private
   * Call VorbisHeader.getHeader(Array<Uint8>) to get instance
   */
  constructor(header: RawVorbisHeader) {
    super(header);

    this.bitrateMaximum = header.bitrateMaximum;
    this.bitrateMinimum = header.bitrateMinimum;
    this.bitrateNominal = header.bitrateNominal;
    this.blocksize0 = header.blocksize0;
    this.blocksize1 = header.blocksize1;
    this.data = header.data;
    this.vorbisComments = null!; // set during ogg parsing
    this.vorbisSetup = null!; // set during ogg parsing
  }
}
