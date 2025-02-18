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

import { headerStore } from "../../globals.js";
import { flacCrc16 } from "../../utilities.js";
import { CodecFrame } from "../CodecFrame.js";
import { FLACHeader } from "./FLACHeader.js";

function getFrameFooterCrc16(data: Uint8Array) {
  return (data[data.length - 2] << 8) + data[data.length - 1];
}

// check frame footer crc
// https://xiph.org/flac/format.html#frame_footer
export function checkFrameFooterCrc16(data: Uint8Array) {
  const expectedCrc16 = getFrameFooterCrc16(data);
  const actualCrc16 = flacCrc16(data.subarray(0, -2));

  return expectedCrc16 === actualCrc16;
}


export class FLACFrame extends CodecFrame<FLACHeader> {
  constructor(data: Uint8Array, header: FLACHeader, streamInfo: Uint8Array) {
    header.streamInfo = streamInfo;
    header.crc16 = getFrameFooterCrc16(data);

    super(header, data, headerStore.get(header).samples);
  }
}
