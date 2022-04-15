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
https://wiki.multimedia.cx/index.php/ADTS

AAAAAAAA AAAABCCD EEFFFFGH HHIJKLMM MMMMMMMM MMMOOOOO OOOOOOPP (QQQQQQQQ QQQQQQQQ)

AACHeader consists of 7 or 9 bytes (without or with CRC).
Letter  Length (bits)  Description
A  12  syncword 0xFFF, all bits must be 1
B  1   MPEG Version: 0 for MPEG-4, 1 for MPEG-2
C  2   Layer: always 0
D  1   protection absent, Warning, set to 1 if there is no CRC and 0 if there is CRC
E  2   profile, the MPEG-4 Audio Object Type minus 1
F  4   MPEG-4 Sampling Frequency Index (15 is forbidden)
G  1   private bit, guaranteed never to be used by MPEG, set to 0 when encoding, ignore when decoding
H  3   MPEG-4 Channel Configuration (in the case of 0, the channel configuration is sent via an inband PCE)
I  1   originality, set to 0 when encoding, ignore when decoding
J  1   home, set to 0 when encoding, ignore when decoding
K  1   copyrighted id bit, the next bit of a centrally registered copyright identifier, set to 0 when encoding, ignore when decoding
L  1   copyright id start, signals that this frame's copyright id bit is the first bit of the copyright id, set to 0 when encoding, ignore when decoding
M  13  frame length, this value must include 7 or 9 bytes of header length: FrameLength = (ProtectionAbsent == 1 ? 7 : 9) + size(AACFrame)
O  11  Buffer fullness // 0x7FF for VBR
P  2   Number of AAC frames (RDBs) in ADTS frame minus 1, for maximum compatibility always use 1 AAC frame per ADTS frame
Q  16  CRC if protection absent is 0 
*/

import { headerStore } from "../../globals";
import { bytesToString } from "../../utilities";
import {
  channelMappings,
  getChannelMapping,
  monophonic,
  lfe,
} from "../../constants";

import { CodecHeader, RawCodecHeader } from "../CodecHeader";
import { ICodecParser } from "../../CodecParser";
import { HeaderCache } from "../HeaderCache";

export type MpegVersion = 4 | 2;

const profiles = ['Main', 'LC', 'SSR', 'LTP'] as const;

export type Profile = typeof profiles[number];

const sampleRates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

const channelModes = [
  { channels: 0, description: "Defined in AOT Specific Config" },
  /*
  'monophonic (mono)'
  'stereo (left, right)'
  'linear surround (front center, front left, front right)'
  'quadraphonic (front center, front left, front right, rear center)'
  '5.0 surround (front center, front left, front right, rear left, rear right)'
  '5.1 surround (front center, front left, front right, rear left, rear right, LFE)'
  '7.1 surround (front center, front left, front right, side left, side right, rear left, rear right, LFE)'
  */
  { channels: 1, description: monophonic },
  { channels: 2, description: getChannelMapping(2, channelMappings[0][0]) },
  { channels: 3, description: getChannelMapping(3, channelMappings[1][3]), },
  { channels: 4, description: getChannelMapping(4, channelMappings[1][3], channelMappings[3][4]), },
  { channels: 5, description: getChannelMapping(5, channelMappings[1][3], channelMappings[3][0]), },
  { channels: 6, description: getChannelMapping(6, channelMappings[1][3], channelMappings[3][0], lfe), },
  { channels: 8, description: getChannelMapping(8, channelMappings[1][3], channelMappings[2][0], channelMappings[3][0], lfe), },
];

type RawAACHeader = RawCodecHeader & {
  mpegVersion: MpegVersion;
  validLayer: boolean;
  protection: boolean;
  length: number;
  profileBits: number;
  sampleRateBits: number;
  profile: Profile;
  isPrivate: boolean;
  channelModeBits: number;
  isOriginal: boolean;
  isHome: boolean;
  copyrightId: boolean;
  copyrightIdStart: boolean;
  samples: number;
  numberAACFrames: number;
  frameLength: number;
  bufferFullness: any;
}

function makeHeader(data: Uint8Array) {
  const header = {} as RawAACHeader;

  // Frame sync (all bits must be set): `11111111|1111`:
  if (data[0] !== 0xff || data[1] < 0xf0) return null;

  // Byte (2 of 7)
  // * `1111BCCD`
  // * `....B...`: MPEG Version: 0 for MPEG-4, 1 for MPEG-2
  // * `.....CC.`: Layer: always 0
  // * `.......D`: protection absent, Warning, set to 1 if there is no CRC and 0 if there is CRC
  header.mpegVersion = (data[1] & 0b00001000) ? 2 : 4;

  header.validLayer = (data[1] & 0b00000110) === 0;
  if (!header.validLayer) return null;

  const protectionBit = data[1] & 0b00000001;
  header.protection = protectionBit ? false : true;
  header.length = protectionBit ? 7 : 9;

  // Byte (3 of 7)
  // * `EEFFFFGH`
  // * `EE......`: profile, the MPEG-4 Audio Object Type minus 1
  // * `..FFFF..`: MPEG-4 Sampling Frequency Index (15 is forbidden)
  // * `......G.`: private bit, guaranteed never to be used by MPEG, set to 0 when encoding, ignore when decoding
  header.profileBits = (data[2] & 0b11000000) >> 6;
  header.sampleRateBits = (data[2] & 0b00111100) >> 2;
  const privateBit = data[2] & 0b00000010;

  header.profile = profiles[header.profileBits];

  header.sampleRate = sampleRates[header.sampleRateBits];
  if (!header.sampleRate) return null;

  header.isPrivate = Boolean(privateBit);

  // Byte (3,4 of 7)
  // * `.......H|HH......`: MPEG-4 Channel Configuration (in the case of 0, the channel configuration is sent via an inband PCE)
  header.channelModeBits = (((data[2] << 8) | data[3]) & 0b111000000) >> 6;
  const chMode = channelModes[header.channelModeBits];
  header.channelMode = chMode.description;
  header.channels = chMode.channels;

  // Byte (4 of 7)
  // * `HHIJKLMM`
  // * `..I.....`: originality, set to 0 when encoding, ignore when decoding
  // * `...J....`: home, set to 0 when encoding, ignore when decoding
  // * `....K...`: copyrighted id bit, the next bit of a centrally registered copyright identifier, set to 0 when encoding, ignore when decoding
  // * `.....L..`: copyright id start, signals that this frame's copyright id bit is the first bit of the copyright id, set to 0 when encoding, ignore when decoding
  header.isOriginal = Boolean(data[3] & 0b00100000);
  header.isHome = Boolean(data[3] & 0b00001000);
  header.copyrightId = Boolean(data[3] & 0b00001000);
  header.copyrightIdStart = Boolean(data[3] & 0b00000100);
  header.bitDepth = 16;
  header.samples = 1024;

  // Byte (7 of 7)
  // * `......PP` Number of AAC frames (RDBs) in ADTS frame minus 1, for maximum compatibility always use 1 AAC frame per ADTS frame
  header.numberAACFrames = data[6] & 0b00000011;

  return header;
}

export function* getHeader(codecParser: ICodecParser, headerCache: HeaderCache, readOffset: number): Generator<Uint8Array, AACHeader | null, Uint8Array> {
  const header = {} as RawAACHeader;

  // Must be at least seven bytes. Out of data
  const data = yield* codecParser.readRawData(7, readOffset);

  // Check header cache
  const key = bytesToString([
    data[0],
    data[1],
    data[2],
    (data[3] & 0b11111100) | (data[6] & 0b00000011), // frame length, buffer fullness varies so don't cache it
  ]);
  const cachedHeader = headerCache.getHeader(key);

  if (!cachedHeader) {
    const newHeader = makeHeader(data);

    if (!newHeader) {
      return null;
    }

    Object.assign(header, newHeader);

    const {
      length,
      channelModeBits,
      profileBits,
      sampleRateBits,
      frameLength,
      samples,
      numberAACFrames,
      ...codecUpdateFields
    } = header;
    headerCache.setHeader(key, header, codecUpdateFields);
  } else {
    Object.assign(header, cachedHeader);
  }

  // Byte (4,5,6 of 7)
  // * `.......MM|MMMMMMMM|MMM.....`: frame length, this value must include 7 or 9 bytes of header length: FrameLength = (ProtectionAbsent == 1 ? 7 : 9) + size(AACFrame)
  const frameLength = ((data[3] << 11) | (data[4] << 3) | (data[5] >> 5)) & 0x1fff;
  if (!frameLength) return null;

  // Byte (6,7 of 7)
  // * `...OOOOO|OOOOOO..`: Buffer fullness
  const bufferFullnessBits = ((data[5] << 6) | (data[6] >> 2)) & 0x7ff;
  const bufferFullness = bufferFullnessBits === 0x7ff ? "VBR" : bufferFullnessBits;

  return new AACHeader({
    ...header,
    frameLength,
    bufferFullness
  });
}

export class AACHeader extends CodecHeader {
  /**
   * @private
   * Call AACHeader.getHeader(Array<Uint8>) to get instance
   */
  constructor(header: RawAACHeader) {
    super(header);

    this.copyrightId = header.copyrightId;
    this.copyrightIdStart = header.copyrightIdStart;
    this.bufferFullness = header.bufferFullness;
    this.isHome = header.isHome;
    this.isOriginal = header.isOriginal;
    this.isPrivate = header.isPrivate;
    this.validLayer = header.validLayer;
    this.length = header.length;
    this.mpegVersion = header.mpegVersion;
    this.numberAACFrames = header.numberAACFrames;
    this.profile = header.profile;
    this.protection = header.protection;
  }

  get audioSpecificConfig() {
    // Audio Specific Configuration
    // * `000EEFFF|F0HHH000`:
    // * `000EE...|........`: Object Type (profileBit + 1)
    // * `.....FFF|F.......`: Sample Rate
    // * `........|.0HHH...`: Channel Configuration
    // * `........|.....0..`: Frame Length (1024)
    // * `........|......0.`: does not depend on core coder
    // * `........|.......0`: Not Extension
    const header = headerStore.get(this);

    const audioSpecificConfig =
      ((header.profileBits + 0x40) << 5) |
      (header.sampleRateBits << 5) |
      (header.channelModeBits >> 3);

    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, audioSpecificConfig, false);
    return bytes;
  }

  mpegVersion: MpegVersion;
  validLayer: boolean;
  protection: boolean;
  length: number;
  // profileBits: number;
  // sampleRateBits: number;
  profile: Profile;
  isPrivate: boolean;
  // channelModeBits: number;
  isOriginal: boolean;
  isHome: boolean;
  copyrightId: boolean;
  copyrightIdStart: boolean;
  // samples: number;
  numberAACFrames: number;
  // frameLength: number;
  bufferFullness: any;
}
