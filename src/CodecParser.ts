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

import { crc32, concatBuffers } from "./utilities";
import HeaderCache from "./codecs/HeaderCache";
import MPEGParser from "./codecs/mpeg/MPEGParser";
import AACParser from "./codecs/aac/AACParser";
import FLACParser from "./codecs/flac/FLACParser";
import OggParser from "./containers/ogg/OggParser";
import Parser from "./codecs/Parser";
import { OnCodec, OnCodecUpdate } from "./types";
import OggPage from "./containers/ogg/OggPage";
import { CodecFrame } from "./codecs/CodecFrame";
import Frame, { Header } from "./containers/Frame";

const noOp = () => {};

export type SupportedMimeTypes = 'audio/mpeg' | 'audio/aac' | 'audio/aacp' | 'audio/flac' | 'audio/ogg' | 'application/ogg';

export type CodecParserOptions = {
  onCodec?: OnCodec;
  onCodecUpdate?: OnCodecUpdate;
  enableLogging?: boolean;
}

export class CodecParser {
  private flushing = false;

  private generator: ReturnType<typeof this.makeGenterator>;
  private totalBytesIn: number = 0;
  private onCodecUpdate?: OnCodecUpdate;
  private enableLogging: boolean | undefined;
  private onCodec: OnCodec;
  private frameNumber: number = 0;
  private currentReadPosition: number = 0;
  private totalSamples: number = 0;
  private totalBytesOut: number = 0;
  private sampleRate: number = 0;

  private parser!: Parser<Frame<Header>, Header>;

  private rawData!: Uint8Array;

  private headerCache!: HeaderCache;


  constructor(private _inputMimeType: SupportedMimeTypes, options: CodecParserOptions = {}) {
    this.onCodec = options.onCodec || noOp;
    this.onCodecUpdate = options.onCodecUpdate;
    this.enableLogging = options.enableLogging;

    this.generator = this.makeGenterator();
    this.generator.next();
  }

  get isFlushing() {
    return this.flushing;
  }

  /**
   * @public
   * @returns The detected codec
   */
  get codec() {
    return this.parser.codec;
  }

  /**
   * @public
   * @description Generator function that yields any buffered CodecFrames and resets the CodecParser
   * @returns {Iterable<CodecFrame|OggPage>} Iterator that operates over the codec data.
   * @yields {CodecFrame|OggPage} Parsed codec or ogg page data
   */
  *flush(): Iterable<CodecFrame | OggPage> {
    this.flushing = true;

    for (let i = this.generator.next(); i.value; i = this.generator.next()) {
      yield i.value;
    }

    this.flushing = false;

    this.generator = this.makeGenterator();
    this.generator.next();
  }

  /**
   * @public
   * @description Generator function takes in a Uint8Array of data and returns a CodecFrame from the data for each iteration
   * @param {Uint8Array} chunk Next chunk of codec data to read
   * @returns {Iterable<CodecFrame|OggPage>} Iterator that operates over the codec data.
   * @yields {CodecFrame|OggPage} Parsed codec or ogg page data
   */
  *parseChunk(chunk: Uint8Array): Generator<Frame<any>> {
    // This will end up being the rawData in Parser's parseFrame
    for (let it = this.generator.next(chunk); it.value; it = this.generator.next()) {
      yield it.value;
    }
  }

  /**
   * Parses an entire file and returns all of the contained frames.
   */
  parseAll(fileData: Uint8Array) {
    return [...this.parseChunk(fileData), ...this.flush()];
  }

  private *makeGenterator(): Generator<Frame<any> | Uint8Array | undefined> {
    this.headerCache = new HeaderCache(this.onCodecUpdate);

    if (this._inputMimeType.match(/aac/)) {
      this.parser = new AACParser(this, this.headerCache, this.onCodec);
    } else if (this._inputMimeType.match(/mpeg/)) {
      this.parser = new MPEGParser(this, this.headerCache, this.onCodec);
    } else if (this._inputMimeType.match(/flac/)) {
      this.parser = new FLACParser(this, this.headerCache, this.onCodec);
    } else if (this._inputMimeType.match(/ogg/)) {
      this.parser = new OggParser(this, this.headerCache, this.onCodec);
    } else {
      throw new Error(`Unsupported Codec ${this._inputMimeType}`);
    }

    this.frameNumber = 0;
    this.currentReadPosition = 0;
    this.totalBytesIn = 0;
    this.totalBytesIn = 0;
    this.totalSamples = 0;
    this.sampleRate = 0;

    this.rawData = new Uint8Array(0);

    // start parsing out frames
    for (;;) {
      const frame = yield* this.parser.parseFrame();
      if (frame) {
        yield frame;
      }
    }
  }

  /**
   * The reader, called by anything that wants data
   * @param minSize Minimum bytes to have present in buffer
   */
  *readRawData(minSize: number = 0, readOffset: number = 0): Generator<Uint8Array, Uint8Array, Uint8Array> {
    while (this.rawData.length <= minSize + readOffset) {
      const newData = yield undefined as any; // Externally consumed

      if (this.flushing) {
        return this.rawData.subarray(readOffset);
      }

      if (newData) {
        this.totalBytesIn += newData.length;
        this.rawData = concatBuffers(this.rawData, newData);
      }
    }

    return this.rawData.subarray(readOffset);
  }

  /**
   * @param {number} increment Bytes to increment codec data
   */
  incrementRawData(increment: number) {
    this.currentReadPosition += increment;
    this.rawData = this.rawData.subarray(increment);
  }

  mapCodecFrameStats(frame: CodecFrame) {
    this.sampleRate = frame.header.sampleRate;

    frame.header.bitrate = Math.round(frame.data.length / frame.duration) * 8;
    frame.frameNumber = this.frameNumber++;
    frame.totalBytesOut = this.totalBytesOut;
    frame.totalSamples = this.totalSamples;
    frame.totalDuration = (this.totalSamples / this.sampleRate) * 1000;
    frame.crc32 = crc32(frame.data);

    this.headerCache.checkCodecUpdate(
      frame.header.bitrate,
      frame.totalDuration
    );

    this.totalBytesOut += frame.data.length;
    this.totalSamples += frame.samples;
  }

  mapFrameStats(frame: Frame<any>) {
    if (frame instanceof OggPage) {
      // Ogg container
      frame.codecFrames.forEach((codecFrame) => {
        frame.duration += codecFrame.duration;
        frame.samples += codecFrame.samples;
        this.mapCodecFrameStats(codecFrame);
      });

      frame.totalSamples = this.totalSamples;
      frame.totalDuration = (this.totalSamples / this.sampleRate) * 1000 || 0;
      frame.totalBytesOut = this.totalBytesOut;
      return;
    }
    
    this.mapCodecFrameStats(frame as CodecFrame);    
  }

  private log(logger: (...args: any[]) => any, messages: any[]) {
    if (this.enableLogging) {
      const stats = [
        `codec:         ${this.codec}`,
        `inputMimeType: ${this._inputMimeType}`,
        `readPosition:  ${this.currentReadPosition}`,
        `totalBytesIn:  ${this.totalBytesIn}`,
        `totalBytesOut: ${this.totalBytesOut}`,
      ];

      const width = Math.max(...stats.map((s) => s.length));

      messages.push(
        `--stats--${"-".repeat(width - 9)}`,
        ...stats,
        "-".repeat(width)
      );

      logger(
        "codec-parser",
        messages.reduce((acc, message) => acc + "\n  " + message, "")
      );
    }
  }

  // Could be function
  /**
   * @protected
   */
  logWarning(...messages: any[]) {
    this.log(console.warn, messages);
  }

  // COuld be function
  /**
   * @protected
   */
  logError(...messages: any[]) {
    this.log(console.error, messages);
  }
}
