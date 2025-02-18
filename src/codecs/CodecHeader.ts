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

import { Header } from "../containers/Frame";
import { headerStore } from "../globals";
import { RawHeader } from "../types";

export type RawCodecHeader = RawHeader & {
  bitDepth: number;  

  channels: number;

  channelMode: string;

  sampleRate: number;
}

export class CodecHeader extends Header {
  constructor(header: RawCodecHeader) {
    super();

    headerStore.set(this, header);

    this.bitDepth = header.bitDepth;
    this.bitrate = null!; // set during frame mapping
    this.channels = header.channels;
    this.channelMode = header.channelMode;
    this.sampleRate = header.sampleRate;
  }

  bitDepth: number;

  bitrate: number;

  channels: number;

  channelMode: string;

  sampleRate: number;
}
