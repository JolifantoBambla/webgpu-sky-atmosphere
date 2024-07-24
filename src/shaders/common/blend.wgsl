/*
 * Copyright (c) 2024 Lukas Herzberger
 * SPDX-License-Identifier: MIT
 */

fn blend(pix: vec2<u32>, src: vec4<f32>) {
	let dst = textureLoad(backbuffer, pix, 0);
	// blend op:        src*1 + dst * (1.0 - srcA)
	// alpha blend op:  src  * 0 + dst * 1
	let rgb = src.rgb + dst.rgb * (1.0 - saturate(src.a));
	let a = dst.a;
	textureStore(render_target, pix, vec4<f32>(rgb, a));
}

fn dual_source_blend(pix: vec2<u32>, src0: vec4<f32>, src1: vec4<f32>) {
	let dst = textureLoad(backbuffer, pix, 0);
	// blend op:        src0 * 1 + dst * src1
	// alpha blend op:  src  * 0 + dst * 1
	let rgb = src0.rgb + dst.rgb * src1.rgb;
	let a = dst.a;
	textureStore(render_target, pix, vec4<f32>(rgb, a));
}
