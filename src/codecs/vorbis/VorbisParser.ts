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

import { CodecParser } from "../../CodecParser";
import OggPage from "../../containers/ogg/OggPage";
import { frameStore } from "../../globals";
import { BitReader, reverse } from "../../utilities";
import { HeaderCache } from "../HeaderCache";
import { Parser } from "../Parser";
import VorbisFrame from "./VorbisFrame";
import VorbisHeader, { getHeaderFromUint8Array } from "./VorbisHeader";

export default class VorbisParser extends Parser<VorbisFrame> {
  private identificationHeader: Uint8Array;
  private mode: any;
  private prevBlockSize: number;
  private currBlockSize: number;
  private vorbisComments!: Uint8Array;
  private vorbisSetup!: Uint8Array;

  constructor(codecParser: CodecParser, headerCache: HeaderCache) {
    super(codecParser, headerCache);

    this.identificationHeader = null!;

    this.mode = {
      count: 0,
    };
    this.prevBlockSize = 0;
    this.currBlockSize = 0;
  }

  get codec() {
    return "vorbis";
  }

  parseOggPage(oggPage: OggPage) {
    const oggPageSegments = frameStore.get(oggPage).segments as Uint8Array[];

    if (oggPage.pageSequenceNumber === 0) {
      // Identification header

      this.headerCache.enable();
      this.identificationHeader = oggPage.data;
    } else if (oggPage.pageSequenceNumber === 1) {
      // gather WEBM CodecPrivate data
      if (oggPageSegments[1]) {
        this.vorbisComments = oggPageSegments[0];
        this.vorbisSetup = oggPageSegments[1];

        this.mode = this._parseSetupHeader(oggPageSegments[1]);
      }
    } else {
      oggPage.codecFrames = oggPageSegments.map((segment) => {
        const header = getHeaderFromUint8Array(
          this.identificationHeader,
          this.headerCache
        );

        if (header) {
          header.vorbisComments = this.vorbisComments;
          header.vorbisSetup = this.vorbisSetup;

          return new VorbisFrame(            
            header,
            segment,
            this._getSamples(segment, header)
          );
        }

        this.codecParser.logError(
          "Failed to parse Ogg Vorbis Header",
          "Not a valid Ogg Vorbis file"
        );
      }) as VorbisFrame[];
    }

    return oggPage;
  }

  _getSamples(segment: Uint8Array, header: VorbisHeader) {
    const byte = segment[0] >> 1;

    const blockFlag = this.mode[byte & this.mode.mask];

    // is this a large window
    if (blockFlag) {
      this.prevBlockSize =
        byte & this.mode.prevMask ? header.blocksize1 : header.blocksize0;
    }

    this.currBlockSize = blockFlag ? header.blocksize1 : header.blocksize0;

    const samples = (this.prevBlockSize + this.currBlockSize) >> 2;
    this.prevBlockSize = this.currBlockSize;

    return samples;
  }

  // https://gitlab.xiph.org/xiph/liboggz/-/blob/master/src/liboggz/oggz_auto.c
  // https://github.com/FFmpeg/FFmpeg/blob/master/libavcodec/vorbis_parser.c
  /*
   * This is the format of the mode data at the end of the packet for all
   * Vorbis Version 1 :
   *
   * [ 6:number_of_modes ]
   * [ 1:size | 16:window_type(0) | 16:transform_type(0) | 8:mapping ]
   * [ 1:size | 16:window_type(0) | 16:transform_type(0) | 8:mapping ]
   * [ 1:size | 16:window_type(0) | 16:transform_type(0) | 8:mapping ]
   * [ 1:framing(1) ]
   *
   * e.g.:
   *
   * MsB         LsB
   *              <-
   * 0 0 0 0 0 1 0 0
   * 0 0 1 0 0 0 0 0
   * 0 0 1 0 0 0 0 0
   * 0 0 1|0 0 0 0 0
   * 0 0 0 0|0|0 0 0
   * 0 0 0 0 0 0 0 0
   * 0 0 0 0|0 0 0 0
   * 0 0 0 0 0 0 0 0
   * 0 0 0 0|0 0 0 0
   * 0 0 0|1|0 0 0 0 |
   * 0 0 0 0 0 0 0 0 V
   * 0 0 0|0 0 0 0 0
   * 0 0 0 0 0 0 0 0
   * 0 0 1|0 0 0 0 0
   *
   * The simplest way to approach this is to start at the end
   * and read backwards to determine the mode configuration.
   *
   * liboggz and ffmpeg both use this method.
   */
  _parseSetupHeader(setup: Uint8Array) {
    const bitReader = new BitReader(setup);
    const failedToParseVorbisStream = "Failed to read Vorbis stream";
    const failedToParseVorbisModes = ", failed to parse vorbis modes";

    let mode: any = {
      count: 0
    };

    // sync with the framing bit
    while ((bitReader.read(1) & 0x01) !== 1) {}

    let modeBits: number = 0;
    // search in reverse to parse out the mode entries
    // limit mode count to 63 so previous block flag will be in first packet byte
    while (mode.count < 64 && bitReader.position > 0) {
      const mapping = reverse(bitReader.read(8));

      if (
        mapping in mode &&
        !(mode.count === 1 && mapping === 0) // allows for the possibility of only one mode
      ) {
        this.codecParser.logError(
          "received duplicate mode mapping" + failedToParseVorbisModes
        );
        throw new Error(failedToParseVorbisStream);
      }

      // 16 bits transform type, 16 bits window type, all values must be zero
      let i = 0;
      while (bitReader.read(8) === 0x00 && i++ < 3) {} // a non-zero value may indicate the end of the mode entries, or invalid data

      if (i === 4) {
        // transform type and window type were all zeros
        modeBits = bitReader.read(7); // modeBits may need to be used in the next iteration if this is the last mode entry
        mode[mapping] = modeBits & 0x01; // read and store mode -> block flag mapping
        bitReader.position += 6; // go back 6 bits so next iteration starts right after the block flag
        mode.count++;
      } else {
        // transform type and window type were not all zeros
        // check for mode count using previous iteration modeBits
        if (((reverse(modeBits) & 0b01111110) >> 1) + 1 !== mode.count) {
          this.codecParser.logError(
            "mode count did not match actual modes" + failedToParseVorbisModes
          );
          throw new Error(failedToParseVorbisStream);
        }

        break;
      }
    }

    // mode mask to read the mode from the first byte in the vorbis frame
    mode.mask = (1 << Math.log2(mode.count)) - 1;
    // previous window flag is the next bit after the mode mask
    mode.prevMask = (mode.mask | 0x1) + 1;

    return mode;
  }
}
