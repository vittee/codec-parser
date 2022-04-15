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

import {
  none,
  sixteenBitCRC,
  monophonic,
  stereo,
} from "../../constants";
import { bytesToString } from "../../utilities";

import { getID3v2Header } from "../../metadata/ID3v2";
import { CodecHeader, RawCodecHeader } from "../CodecHeader";
import { ICodecParser } from "../../CodecParser";
import { HeaderCache } from "../HeaderCache";

// http://www.mp3-tech.org/programmer/frame_header.html

const bands = "bands ";
const to31 = " to 31";

const layer12ModeExtensions = {
  0b00000000: bands + 4 + to31,
  0b00010000: bands + 8 + to31,
  0b00100000: bands + 12 + to31,
  0b00110000: bands + 16 + to31,
};

const intensityStereo = "Intensity stereo ";
const msStereo = ", MS stereo ";
const on = "on";
const off = "off";

const layer3ModeExtensions: Record<number, string> = {
  0b00000000: intensityStereo + off + msStereo + off,
  0b00010000: intensityStereo + on + msStereo + off,
  0b00100000: intensityStereo + off + msStereo + on,
  0b00110000: intensityStereo + on + msStereo + on,
};

type L12MEB = [4 | 8 | 12 | 16, 31];

type L3ME = {
  intensityStereo: boolean;
  msStereo: boolean;
}

type Layer1Info = {
  layer: 1;
  description: string;
  framePadding: 4;
  modeExtensions: [L12MEB, L12MEB, L12MEB, L12MEB];
}

type Layer2Info = {
  layer: 2;
  description: string;
  framePadding: 1;
  modeExtensions: [L12MEB, L12MEB, L12MEB, L12MEB];
}

type Layer3Info = {
  layer: 3;
  description: string;
  framePadding: 1;
  modeExtensions: [L3ME, L3ME, L3ME, L3ME];
}

const layerInfos: [undefined, Layer3Info, Layer2Info, Layer1Info] = [
  undefined,
  {
    layer: 3,
    description: "Layer III",
    framePadding: 1,
    modeExtensions: layer3ModeExtensions as any, // TODO:
  },
  {
    layer: 2,
    description: "Layer II",
    framePadding: 1,
    modeExtensions: layer12ModeExtensions as any, // TODO:    
  },
  {
    layer: 1,
    description: "Layer I",
    framePadding: 4,
    modeExtensions: layer12ModeExtensions as any, // TODO:
  },
];

type LayerBitrates = [undefined, number, number, number, number, number, number, number, number, number, number, number, number, number, number, -1];

type VersionSpecificLayer = {
  bitrates: LayerBitrates;
  samples: number;
}

type VersionSpecificLayers = [undefined, VersionSpecificLayer, VersionSpecificLayer, VersionSpecificLayer];

type MpegVersion = {
  description: string;
  layers: VersionSpecificLayers;
  sampleRates: [number, number, number];
}

const version2Layer2And3Bitrates: LayerBitrates = [undefined, 8,  16, 24, 32, 40, 48,  56,  64,  80,  96, 112, 128, 144, 160, -1];

const version2LayerInfos: VersionSpecificLayers = [
  undefined,
  // Layer III
  { samples: 576, bitrates: version2Layer2And3Bitrates }, 
  // Layer II
  { samples: 1152, bitrates: version2Layer2And3Bitrates },
  // Layer I
  { samples:  384, bitrates: [undefined, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256 ,-1] }    
];

const version1LayerInfos: VersionSpecificLayers = [
  undefined,
  // Layer III
  { samples: 1152, bitrates: [undefined, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, -1] },
  // Layer II
  { samples: 1152, bitrates: [undefined, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, -1] },
  // Layer I
  { samples:  384, bitrates: [undefined, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, -1]}
];

const mpegVersions: [MpegVersion, undefined, MpegVersion, MpegVersion] = [
  {
    description: `MPEG Version 2.5 (later extension of MPEG 2)`,
    layers: version2LayerInfos,
    sampleRates: [11025, 12000, 8000]
  },
  undefined,
  {
    description: `MPEG Version 2 (ISO/IEC 13818-3)`,
    layers: version2LayerInfos,
    sampleRates: [22050, 24000, 16000]
  },
  {
    description: `MPEG Version 1 (ISO/IEC 11172-3)`,
    layers: version1LayerInfos,
    sampleRates: [44100, 48000, 32000]
  },
];

const emphasis = ["none", "50/15 ms", undefined, "CCIT J.17"] as const; 

export type Emphasis = typeof emphasis[number];

const channelModes: Record<number, any> = { // TODO: define shape
  0b00000000: { channels: 2, description: stereo },
  0b01000000: { channels: 2, description: "joint " + stereo },
  0b10000000: { channels: 2, description: "dual channel" },
  0b11000000: { channels: 1, description: monophonic },
};

type RawMPEGHeader = RawCodecHeader & {
  mpegVersion: string;
  layer: string;
  samples: number;
  protection: string;
  framePadding: number;
  isPrivate: boolean;
  frameLength: number;
  modeExtension: string;
  isCopyrighted: boolean;
  isOriginal: boolean;
  emphasis: Emphasis;
  bitrate: number;  
}

export function* getHeader(codecParser: ICodecParser, headerCache: HeaderCache, readOffset: number) {
  const header = {} as RawMPEGHeader;

  // check for id3 header
  const id3v2Header = yield* getID3v2Header(
    codecParser,
    headerCache,
    readOffset
  );

  if (id3v2Header) {
    // throw away the data. id3 parsing is not implemented yet.
    yield* codecParser.readRawData(id3v2Header.length, readOffset);
    codecParser.incrementRawData(id3v2Header.length);
  }

  // Must be at least four bytes.
  const data = yield* codecParser.readRawData(4, readOffset);

  // Check header cache
  const key = bytesToString(data.subarray(0, 4));
  const cachedHeader = headerCache.getHeader(key);
  if (cachedHeader) return new MPEGHeader(cachedHeader);

  // Frame sync (all bits must be set): `11111111|111`:
  if (data[0] !== 0xff || data[1] < 0xe0) return;

  // Byte (2 of 4)
  // * `111BBCCD`
  // * `...BB...`: MPEG Audio version ID
  // * `.....CC.`: Layer description
  // * `.......D`: Protection bit (0 - Protected by CRC (16bit CRC follows header), 1 = Not protected)

  // Mpeg version (1, 2, 2.5)
  const mpegVersion = mpegVersions[(data[1] & 0b00011000) >> 3];
  if (!mpegVersion) return;

  // Layer (I, II, III)
  const layerBits = (data[1] & 0b00000110) >> 1;

  const layer = layerInfos[layerBits];
  if (!layer) return;
  

  header.mpegVersion = mpegVersion.description;
  header.layer = layer.description;

  header.samples = mpegVersion.layers[layerBits]?.samples || 0;
  header.protection = (data[1] & 0b00000001) ? none : sixteenBitCRC;

  header.length = 4;

  // Byte (3 of 4)
  // * `EEEEFFGH`
  // * `EEEE....`: Bitrate index. 1111 is invalid, everything else is accepted
  // * `....FF..`: Sample rate
  // * `......G.`: Padding bit, 0=frame not padded, 1=frame padded
  // * `.......H`: Private bit.
  header.bitrate = mpegVersion.layers[layerBits]?.bitrates[(data[2] & 0b11110000) >> 4] || 0;
  if (header.bitrate === -1) return;

  header.sampleRate = mpegVersion.sampleRates![(data[2] & 0b00001100) >> 2] as number;
  if (!header.sampleRate) return;

  header.framePadding = data[2] & 0b00000010 && (layer.framePadding ?? 0);
  header.isPrivate = Boolean(data[2] & 0b00000001);

  header.frameLength = Math.floor(
    (125 * header.bitrate * header.samples) / header.sampleRate +
      header.framePadding
  );
  if (!header.frameLength) return;

  // Byte (4 of 4)
  // * `IIJJKLMM`
  // * `II......`: Channel mode
  // * `..JJ....`: Mode extension (only if joint stereo)
  // * `....K...`: Copyright
  // * `.....L..`: Original
  // * `......MM`: Emphasis
  const channelModeBits = data[3] & 0b11000000;
  header.channelMode = channelModes[channelModeBits].description;
  header.channels = channelModes[channelModeBits].channels;

  header.modeExtension = layer.modeExtensions![data[3] & 0b00110000] as unknown as string; // TODO:
  header.isCopyrighted = Boolean(data[3] & 0b00001000);
  header.isOriginal = Boolean(data[3] & 0b00000100);

  header.emphasis = emphasis[data[3] & 0b00000011];
  if (!header.emphasis) return;

  header.bitDepth = 16;

  // set header cache
  const { length, frameLength, samples, ...codecUpdateFields } = header;

  headerCache.setHeader(key, header, codecUpdateFields);
  return new MPEGHeader(header);
}

export class MPEGHeader extends CodecHeader {
  /**
   * Call MPEGHeader.getHeader(Array<Uint8>) to get instance
   */
  constructor(header: RawMPEGHeader) {
    super(header);

    this.bitrate = header.bitrate;
    this.emphasis = header.emphasis;
    this.framePadding = header.framePadding;
    this.isCopyrighted = header.isCopyrighted;
    this.isOriginal = header.isOriginal;
    this.isPrivate = header.isPrivate;
    this.layer = header.layer;
    this.modeExtension = header.modeExtension;
    this.mpegVersion = header.mpegVersion;
    this.protection = header.protection;
  }

  mpegVersion: string;
  layer: string;
  samples?: number;
  protection: string;
  length?: number;
  framePadding: number;
  isPrivate: boolean;
  frameLength?: number;
  modeExtension: string;
  isCopyrighted: boolean;
  isOriginal: boolean;
  emphasis: Emphasis;
}
