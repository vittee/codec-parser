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
import { OnCodec } from "../../types";
import { HeaderCache } from "../HeaderCache";
import { Parser } from "../Parser";
import { AACFrame, getFrame } from "./AACFrame";
import { getHeader } from "./AACHeader";

export class AACParser extends Parser<AACFrame> {
  constructor(codecParser: CodecParser, headerCache: HeaderCache, onCodec: OnCodec) {
    super(codecParser, headerCache, getFrame, getHeader);

    onCodec(this.codec);
  }

  get codec() {
    return "aac";
  }

  override *parseFrame() {
    return yield* this.fixedLengthFrameSync();
  }
}
