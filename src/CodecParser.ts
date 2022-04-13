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
import { OnCodecUpdate } from "./types";
import OggPage from "./containers/ogg/OggPage";
import { CodecFrame } from "./codecs/CodecFrame";

const noOp = () => {};

export type SupportedMimeTypes = 'audio/mpeg' | 'audio/aac' | 'audio/aacp' | 'audio/flac' | 'audio/ogg' | 'application/ogg';

export type CodecParserOptions = {
  onCodec?: any; // TODO:
  onCodecUpdate?: any;
  enableLogging?: boolean;
}

export class CodecParser {
  private _flushing = false;

  private _generator: ReturnType<typeof this._getGenerator>;
  private _totalBytesIn: number = 0;
  private _onCodecUpdate: OnCodecUpdate;
  private _enableLogging: boolean | undefined;
  private _onCodec: any;
  private _frameNumber: number = 0;
  private _currentReadPosition: number = 0;
  private _totalSamples: number = 0;
  private _totalBytesOut: number = 0;
  private _sampleRate: number = 0;

  private _parser!: Parser<any, any>;

  private _rawData!: Uint8Array;

  private _headerCache!: HeaderCache;


  constructor(private _inputMimeType: SupportedMimeTypes, options: CodecParserOptions = {}) {
    this._onCodec = options.onCodec || noOp;
    this._onCodecUpdate = options.onCodecUpdate;
    this._enableLogging = options.enableLogging;

    this._generator = this._getGenerator();
    this._generator.next();
  }

  get isFlushing() {
    return this._flushing;
  }

  /**
   * @public
   * @returns The detected codec
   */
  get codec() {
    return this._parser.codec;
  }

  /**
   * @public
   * @description Generator function that yields any buffered CodecFrames and resets the CodecParser
   * @returns {Iterable<CodecFrame|OggPage>} Iterator that operates over the codec data.
   * @yields {CodecFrame|OggPage} Parsed codec or ogg page data
   */
  *flush(): Iterable<CodecFrame | OggPage> {
    this._flushing = true;

    for (let i = this._generator.next(); i.value; i = this._generator.next()) {
      yield i.value;
    }

    this._flushing = false;

    this._generator = this._getGenerator();
    this._generator.next();
  }

  /**
   * @public
   * @description Generator function takes in a Uint8Array of data and returns a CodecFrame from the data for each iteration
   * @param {Uint8Array} chunk Next chunk of codec data to read
   * @returns {Iterable<CodecFrame|OggPage>} Iterator that operates over the codec data.
   * @yields {CodecFrame|OggPage} Parsed codec or ogg page data
   */
  *parseChunk(chunk: Uint8Array): Iterable<CodecFrame<any> | OggPage> {
    // This will end up being the rawData in Parser's parseFrame
    for (let it = this._generator.next(chunk); it.value; it = this._generator.next()) {
      yield it.value;
    }
  }

  /**
   * @public
   * @description Parses an entire file and returns all of the contained frames.
   * @param {Uint8Array} fileData Coded data to read
   * @returns {Array<CodecFrame|OggPage>} CodecFrames
   */
  parseAll(fileData: Uint8Array) {
    return [...this.parseChunk(fileData), ...this.flush()];
  }

  /**
   * @private
   */
  *_getGenerator(): Generator<CodecFrame | OggPage, any> {
    this._headerCache = new HeaderCache(this._onCodecUpdate);

    if (this._inputMimeType.match(/aac/)) {
      this._parser = new AACParser(this, this._headerCache, this._onCodec);
    } else if (this._inputMimeType.match(/mpeg/)) {
      this._parser = new MPEGParser(this, this._headerCache, this._onCodec);
    } else if (this._inputMimeType.match(/flac/)) {
      this._parser = new FLACParser(this, this._headerCache, this._onCodec);
    } else if (this._inputMimeType.match(/ogg/)) {
      this._parser = new OggParser(this, this._headerCache, this._onCodec);
    } else {
      throw new Error(`Unsupported Codec ${this._inputMimeType}`);
    }

    this._frameNumber = 0;
    this._currentReadPosition = 0;
    this._totalBytesIn = 0;
    this._totalBytesIn = 0;
    this._totalSamples = 0;
    this._sampleRate = 0;

    this._rawData = new Uint8Array(0);

    // start parsing out frames
    for (;;) {
      const frame = yield* this._parser.parseFrame();
      if (frame) {
        yield frame;
      }
    }
  }

  /**
   * The reader, called by anything that wants data
   * @protected
   * @param {number} minSize Minimum bytes to have present in buffer
   * @returns {Uint8Array} rawData
   */
  *readRawData(minSize: number = 0, readOffset: number = 0): Generator {
    while (this._rawData.length <= minSize + readOffset) {
      const newData = yield; // Externally consume

      if (this._flushing) {
        return this._rawData.subarray(readOffset);
      }

      if (newData) {
        this._totalBytesIn += newData.length;
        this._rawData = concatBuffers(this._rawData, newData);
      }
    }

    return this._rawData.subarray(readOffset);
  }

  /**
   * @protected
   * @param {number} increment Bytes to increment codec data
   */
  incrementRawData(increment: number) {
    this._currentReadPosition += increment;
    this._rawData = this._rawData.subarray(increment);
  }

  /**
   * @protected
   */
  mapCodecFrameStats(frame: CodecFrame) {
    this._sampleRate = frame.header.sampleRate;

    frame.header.bitrate = Math.round(frame.data.length / frame.duration) * 8;
    frame.frameNumber = this._frameNumber++;
    frame.totalBytesOut = this._totalBytesOut;
    frame.totalSamples = this._totalSamples;
    frame.totalDuration = (this._totalSamples / this._sampleRate) * 1000;
    frame.crc32 = crc32(frame.data);

    this._headerCache.checkCodecUpdate(
      frame.header.bitrate,
      frame.totalDuration
    );

    this._totalBytesOut += frame.data.length;
    this._totalSamples += frame.samples;
  }

  /**
   * @protected
   */
  mapFrameStats(frame: CodecFrame | OggPage) {
    if (frame instanceof OggPage) {
      // Ogg container
      frame.codecFrames.forEach((codecFrame) => {
        frame.duration += codecFrame.duration;
        frame.samples += codecFrame.samples;
        this.mapCodecFrameStats(codecFrame);
      });

      frame.totalSamples = this._totalSamples;
      frame.totalDuration = (this._totalSamples / this._sampleRate) * 1000 || 0;
      frame.totalBytesOut = this._totalBytesOut;
      return;
    }
    
    this.mapCodecFrameStats(frame);    
  }

  /**
   * @private
   */
  _log(logger: (...args: any[]) => any, messages: any[]) {
    if (this._enableLogging) {
      const stats = [
        `codec:         ${this.codec}`,
        `inputMimeType: ${this._inputMimeType}`,
        `readPosition:  ${this._currentReadPosition}`,
        `totalBytesIn:  ${this._totalBytesIn}`,
        `totalBytesOut: ${this._totalBytesOut}`,
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

  /**
   * @protected
   */
  logWarning(...messages: any[]) {
    this._log(console.warn, messages);
  }

  /**
   * @protected
   */
  logError(...messages: any[]) {
    this._log(console.error, messages);
  }
}
