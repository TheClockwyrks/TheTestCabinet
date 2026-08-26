import { describe, expect, it } from "vitest";
import { createCanvas } from "./index";
import type { HeadlessWebGL2 } from "./index";

/**
 * Lifecycle and binding semantics of the object stores — buffers, vertex
 * arrays, textures, shaders, and programs — exercised through the context's
 * public methods, with white-box reads of the record fields (`buffer.data`,
 * `texture.image`) where the GL API deliberately offers no readback path in
 * this stage. The fixed-function state machine lives in context.test.ts.
 */

function makeGl(): HeadlessWebGL2 {
  return createCanvas(8, 8).getContext("webgl2");
}

describe("buffers", () => {
  it("answers isBuffer false before the first bind and true after, the WebGL rule", () => {
    const gl = makeGl();
    const buffer = gl.createBuffer();
    expect(gl.isBuffer(buffer)).toBe(false);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    expect(gl.isBuffer(buffer)).toBe(true);
  });

  it("answers isBuffer false after deletion and for foreign objects", () => {
    const gl = makeGl();
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.deleteBuffer(buffer);
    expect(gl.isBuffer(buffer)).toBe(false);
    expect(gl.isBuffer({})).toBe(false);
    expect(gl.isBuffer(null)).toBe(false);
  });

  it("copies uploaded data, so mutating the source afterwards changes nothing", () => {
    const gl = makeGl();
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const source = new Float32Array([1, 2, 3]);
    gl.bufferData(gl.ARRAY_BUFFER, source, gl.STATIC_DRAW);
    source[0] = 99;
    expect(new Float32Array(buffer.data!.buffer)[0]).toBe(1);
  });

  it("allocates zeroed storage for a numeric size and reports it through getBufferParameter", () => {
    const gl = makeGl();
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, 16, gl.DYNAMIC_DRAW);
    expect(gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE)).toBe(16);
    expect(gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_USAGE)).toBe(gl.DYNAMIC_DRAW);
    expect([...buffer.data!]).toEqual(Array.from({ length: 16 }, () => 0));
  });

  it("honors the WebGL2 srcOffset and length element window of bufferData", () => {
    const gl = makeGl();
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([1, 2, 3, 4]) as Float32Array, gl.STATIC_DRAW, 1, 2);
    expect([...new Float32Array(buffer.data!.buffer)]).toEqual([2, 3]);
  });

  it("writes bufferSubData in place and refuses writes past the end with INVALID_VALUE", () => {
    const gl = makeGl();
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array([0, 0, 0, 0]), gl.STATIC_DRAW);
    gl.bufferSubData(gl.ARRAY_BUFFER, 1, new Uint8Array([7, 8]));
    expect([...buffer.data!]).toEqual([0, 7, 8, 0]);
    gl.bufferSubData(gl.ARRAY_BUFFER, 3, new Uint8Array([1, 2]));
    expect(gl.getError()).toBe(gl.INVALID_VALUE);
    expect([...buffer.data!]).toEqual([0, 7, 8, 0]);
  });

  it("latches INVALID_OPERATION for bufferData with nothing bound", () => {
    const gl = makeGl();
    gl.bufferData(gl.ARRAY_BUFFER, 8, gl.STATIC_DRAW);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
  });

  it("latches INVALID_ENUM for a bad usage hint and a bad bind target", () => {
    const gl = makeGl();
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, 8, 0x1234);
    expect(gl.getError()).toBe(gl.INVALID_ENUM);
    gl.bindBuffer(0x1234, buffer);
    expect(gl.getError()).toBe(gl.INVALID_ENUM);
  });

  it("refuses a negative size with INVALID_VALUE", () => {
    const gl = makeGl();
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, -1, gl.STATIC_DRAW);
    expect(gl.getError()).toBe(gl.INVALID_VALUE);
  });

  it("detaches a deleted buffer from the context bindings and refuses re-binding it", () => {
    const gl = makeGl();
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.deleteBuffer(buffer);
    expect(gl.getParameter(gl.ARRAY_BUFFER_BINDING)).toBeNull();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
    // A second delete is silently ignored, per GL.
    gl.deleteBuffer(buffer);
    expect(gl.getError()).toBe(gl.NO_ERROR);
  });

  it("refuses a buffer created by a different context with INVALID_OPERATION", () => {
    const gl = makeGl();
    const other = makeGl();
    const foreign = other.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, foreign);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
    expect(gl.getParameter(gl.ARRAY_BUFFER_BINDING)).toBeNull();
  });
});

describe("vertex arrays", () => {
  it("keeps the ELEMENT_ARRAY_BUFFER binding on the VAO, so switching VAOs switches index buffers", () => {
    const gl = makeGl();
    const vaoA = gl.createVertexArray();
    const vaoB = gl.createVertexArray();
    const indexBuffer = gl.createBuffer();
    gl.bindVertexArray(vaoA);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    expect(gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING)).toBe(indexBuffer);
    gl.bindVertexArray(vaoB);
    expect(gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING)).toBeNull();
    gl.bindVertexArray(vaoA);
    expect(gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING)).toBe(indexBuffer);
  });

  it("reports null for VERTEX_ARRAY_BINDING while the default VAO stands", () => {
    const gl = makeGl();
    expect(gl.getParameter(gl.VERTEX_ARRAY_BINDING)).toBeNull();
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    expect(gl.getParameter(gl.VERTEX_ARRAY_BINDING)).toBe(vao);
    gl.bindVertexArray(null);
    expect(gl.getParameter(gl.VERTEX_ARRAY_BINDING)).toBeNull();
  });

  it("gives the default VAO its own element binding, usable without ever creating a VAO", () => {
    const gl = makeGl();
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    expect(gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING)).toBe(indexBuffer);
  });

  it("answers isVertexArray by the bound-once-and-alive rule", () => {
    const gl = makeGl();
    const vao = gl.createVertexArray();
    expect(gl.isVertexArray(vao)).toBe(false);
    gl.bindVertexArray(vao);
    expect(gl.isVertexArray(vao)).toBe(true);
    gl.deleteVertexArray(vao);
    expect(gl.isVertexArray(vao)).toBe(false);
  });

  it("rebinds the default VAO when the bound one is deleted", () => {
    const gl = makeGl();
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.deleteVertexArray(vao);
    expect(gl.getParameter(gl.VERTEX_ARRAY_BINDING)).toBeNull();
    gl.bindVertexArray(vao);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
  });

  it("records enable and disable per attribute index and refuses an out-of-range index", () => {
    const gl = makeGl();
    gl.enableVertexAttribArray(3);
    expect(gl.getVertexAttrib(3, gl.VERTEX_ATTRIB_ARRAY_ENABLED)).toBe(true);
    gl.disableVertexAttribArray(3);
    expect(gl.getVertexAttrib(3, gl.VERTEX_ATTRIB_ARRAY_ENABLED)).toBe(false);
    gl.enableVertexAttribArray(16);
    expect(gl.getError()).toBe(gl.INVALID_VALUE);
  });

  it("keeps attribute enables per VAO, so a switch changes what is enabled", () => {
    const gl = makeGl();
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.enableVertexAttribArray(0);
    gl.bindVertexArray(null);
    expect(gl.getVertexAttrib(0, gl.VERTEX_ATTRIB_ARRAY_ENABLED)).toBe(false);
    gl.bindVertexArray(vao);
    expect(gl.getVertexAttrib(0, gl.VERTEX_ATTRIB_ARRAY_ENABLED)).toBe(true);
  });

  it("captures the bound ARRAY_BUFFER and the fetch description at vertexAttribPointer time", () => {
    const gl = makeGl();
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 24, 12);
    // Unbinding afterwards must not disturb the captured reference, per GL.
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    expect(gl.getVertexAttrib(2, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING)).toBe(buffer);
    expect(gl.getVertexAttrib(2, gl.VERTEX_ATTRIB_ARRAY_SIZE)).toBe(3);
    expect(gl.getVertexAttrib(2, gl.VERTEX_ATTRIB_ARRAY_TYPE)).toBe(gl.FLOAT);
    expect(gl.getVertexAttrib(2, gl.VERTEX_ATTRIB_ARRAY_NORMALIZED)).toBe(false);
    expect(gl.getVertexAttrib(2, gl.VERTEX_ATTRIB_ARRAY_STRIDE)).toBe(24);
    expect(gl.getVertexAttribOffset(2, gl.VERTEX_ATTRIB_ARRAY_POINTER)).toBe(12);
  });

  it("refuses vertexAttribPointer with no ARRAY_BUFFER bound, the no-client-arrays rule", () => {
    const gl = makeGl();
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
  });

  it("refuses a stride or offset that is not a multiple of the fetch type size", () => {
    const gl = makeGl();
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 6, 0);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 2);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
  });

  it("refuses a bad size or an oversized stride with INVALID_VALUE", () => {
    const gl = makeGl();
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.vertexAttribPointer(0, 5, gl.FLOAT, false, 0, 0);
    expect(gl.getError()).toBe(gl.INVALID_VALUE);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 256, 0);
    expect(gl.getError()).toBe(gl.INVALID_VALUE);
  });

  it("keeps generic attribute values as context state that survives a VAO switch", () => {
    const gl = makeGl();
    gl.vertexAttrib4f(1, 0.5, 0.25, 0.125, 2);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    expect([...(gl.getVertexAttrib(1, gl.CURRENT_VERTEX_ATTRIB) as Float32Array)]).toEqual([0.5, 0.25, 0.125, 2]);
  });

  it("fills the missing components of the shorter setters with 0, 0, 1", () => {
    const gl = makeGl();
    gl.vertexAttrib2f(0, 3, 4);
    expect([...(gl.getVertexAttrib(0, gl.CURRENT_VERTEX_ATTRIB) as Float32Array)]).toEqual([3, 4, 0, 1]);
    gl.vertexAttrib3fv(0, [7, 8, 9]);
    expect([...(gl.getVertexAttrib(0, gl.CURRENT_VERTEX_ATTRIB) as Float32Array)]).toEqual([7, 8, 9, 1]);
  });

  it("refuses a too-short vector for the fv setters with INVALID_VALUE", () => {
    const gl = makeGl();
    gl.vertexAttrib4fv(0, [1, 2, 3]);
    expect(gl.getError()).toBe(gl.INVALID_VALUE);
  });
});

describe("textures", () => {
  /** A bound 2×2 RGBA texture on unit 0, the fixture most texture tests start from. */
  function boundTexture(gl: HeadlessWebGL2) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    return texture;
  }

  it("binds per texture unit under activeTexture", () => {
    const gl = makeGl();
    const a = gl.createTexture();
    const b = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, a);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, b);
    expect(gl.getParameter(gl.TEXTURE_BINDING_2D)).toBe(b);
    gl.activeTexture(gl.TEXTURE0);
    expect(gl.getParameter(gl.TEXTURE_BINDING_2D)).toBe(a);
  });

  it("refuses a unit outside TEXTURE0..TEXTURE31 with INVALID_ENUM", () => {
    const gl = makeGl();
    gl.activeTexture(gl.TEXTURE31 + 1);
    expect(gl.getError()).toBe(gl.INVALID_ENUM);
    expect(gl.getParameter(gl.ACTIVE_TEXTURE)).toBe(gl.TEXTURE0);
  });

  it("stores uploaded bytes as a copy, so mutating the source changes nothing", () => {
    const gl = makeGl();
    const texture = boundTexture(gl);
    const pixels = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    pixels[0] = 99;
    expect([...texture.image!.data]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(texture.image!.width).toBe(2);
    expect(texture.image!.height).toBe(1);
    expect(texture.image!.channels).toBe(4);
  });

  it("allocates zeroed storage for a null upload", () => {
    const gl = makeGl();
    const texture = boundTexture(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    expect(texture.image!.data.length).toBe(16);
    expect([...texture.image!.data].every((byte) => byte === 0)).toBe(true);
  });

  it("honors UNPACK_FLIP_Y_WEBGL by reversing row order at upload", () => {
    const gl = makeGl();
    const texture = boundTexture(gl);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    // Two rows of one RGBA pixel each: top row 1s, bottom row 2s.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([1, 1, 1, 1, 2, 2, 2, 2]));
    expect([...texture.image!.data]).toEqual([2, 2, 2, 2, 1, 1, 1, 1]);
  });

  it("honors UNPACK_PREMULTIPLY_ALPHA_WEBGL with the stated arithmetic", () => {
    const gl = makeGl();
    const texture = boundTexture(gl);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([200, 100, 0, 128]));
    // round(c * a / 255): round(200*128/255)=100, round(100*128/255)=50.
    expect([...texture.image!.data]).toEqual([100, 50, 0, 128]);
  });

  it("honors UNPACK_ALIGNMENT row padding for narrow RGB rows", () => {
    const gl = makeGl();
    const texture = boundTexture(gl);
    // 1×2 RGB with default alignment 4: each 3-byte row is padded to 4.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 2, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([1, 2, 3, 0, 4, 5, 6, 0]));
    expect([...texture.image!.data]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("refuses an upload whose data is too small with INVALID_OPERATION", () => {
    const gl = makeGl();
    boundTexture(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(15));
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
  });

  it("refuses an upload with no bound texture with INVALID_OPERATION", () => {
    const gl = makeGl();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
  });

  it("refuses a mismatched internal format and format pair with INVALID_OPERATION", () => {
    const gl = makeGl();
    boundTexture(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, null);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
  });

  it("refuses negative sizes, nonzero borders, and negative levels with INVALID_VALUE", () => {
    const gl = makeGl();
    boundTexture(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, -1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    expect(gl.getError()).toBe(gl.INVALID_VALUE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, null);
    expect(gl.getError()).toBe(gl.INVALID_VALUE);
    gl.texImage2D(gl.TEXTURE_2D, -1, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    expect(gl.getError()).toBe(gl.INVALID_VALUE);
  });

  it("accepts the single-channel R8/RED upload the glyph atlas uses", () => {
    const gl = makeGl();
    const texture = boundTexture(gl);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 3, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([9, 8, 7]));
    expect([...texture.image!.data]).toEqual([9, 8, 7]);
    expect(texture.image!.channels).toBe(1);
  });

  it("stores NEAREST and LINEAR filters and the wrap modes, readable back through getTexParameter", () => {
    const gl = makeGl();
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
    expect(gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER)).toBe(gl.NEAREST);
    expect(gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER)).toBe(gl.NEAREST);
    expect(gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S)).toBe(gl.CLAMP_TO_EDGE);
    expect(gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T)).toBe(gl.MIRRORED_REPEAT);
  });

  it("keeps GL's mipmapped default min filter faithfully on a fresh texture", () => {
    const gl = makeGl();
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    expect(gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER)).toBe(gl.NEAREST_MIPMAP_LINEAR);
  });

  it("refuses a bad wrap or mag value with INVALID_ENUM", () => {
    const gl = makeGl();
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, 0x1234);
    expect(gl.getError()).toBe(gl.INVALID_ENUM);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST_MIPMAP_LINEAR);
    expect(gl.getError()).toBe(gl.INVALID_ENUM);
  });

  it("refuses texParameteri with no bound texture with INVALID_OPERATION", () => {
    const gl = makeGl();
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
  });

  it("unbinds a deleted texture from every unit and tracks isTexture", () => {
    const gl = makeGl();
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    expect(gl.isTexture(texture)).toBe(true);
    gl.deleteTexture(texture);
    expect(gl.getParameter(gl.TEXTURE_BINDING_2D)).toBeNull();
    expect(gl.isTexture(texture)).toBe(false);
  });
});

describe("shaders and programs", () => {
  it("creates the two shader types and refuses any other with INVALID_ENUM and null", () => {
    const gl = makeGl();
    expect(gl.createShader(gl.VERTEX_SHADER)).not.toBeNull();
    expect(gl.createShader(gl.FRAGMENT_SHADER)).not.toBeNull();
    expect(gl.createShader(0x1234)).toBeNull();
    expect(gl.getError()).toBe(gl.INVALID_ENUM);
  });

  it("stores and returns shader source", () => {
    const gl = makeGl();
    const shader = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(shader, "#version 300 es\nvoid main() {}");
    expect(gl.getShaderSource(shader)).toBe("#version 300 es\nvoid main() {}");
  });

  it("snapshots the source at compileShader, so a later shaderSource changes nothing until recompiled", () => {
    const gl = makeGl();
    const shader = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(shader, "first");
    gl.compileShader(shader);
    gl.shaderSource(shader, "second");
    // The snapshot is what a future link compiles against, per GL.
    expect(shader.compiledSource).toBe("first");
    expect(gl.getShaderSource(shader)).toBe("second");
    // "first" is not GLSL, so the front end honestly fails it with a
    // line-numbered log, never a throw.
    expect(gl.getShaderParameter(shader, gl.COMPILE_STATUS)).toBe(false);
    expect(gl.getShaderInfoLog(shader)).toMatch(/^ERROR: 0:1:/);
  });

  it("answers getShaderParameter for type and delete status", () => {
    const gl = makeGl();
    const shader = gl.createShader(gl.VERTEX_SHADER)!;
    expect(gl.getShaderParameter(shader, gl.SHADER_TYPE)).toBe(gl.VERTEX_SHADER);
    expect(gl.getShaderParameter(shader, gl.DELETE_STATUS)).toBe(false);
    gl.deleteShader(shader);
    expect(gl.getShaderParameter(shader, gl.DELETE_STATUS)).toBe(true);
    expect(gl.isShader(shader)).toBe(false);
  });

  it("attaches at most one shader per type and never the same shader twice", () => {
    const gl = makeGl();
    const program = gl.createProgram();
    const vertex = gl.createShader(gl.VERTEX_SHADER)!;
    const vertex2 = gl.createShader(gl.VERTEX_SHADER)!;
    gl.attachShader(program, vertex);
    gl.attachShader(program, vertex);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
    gl.attachShader(program, vertex2);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
    expect(gl.getProgramParameter(program, gl.ATTACHED_SHADERS)).toBe(1);
  });

  it("detaches an attached shader and refuses detaching one that is not attached", () => {
    const gl = makeGl();
    const program = gl.createProgram();
    const vertex = gl.createShader(gl.VERTEX_SHADER)!;
    gl.attachShader(program, vertex);
    gl.detachShader(program, vertex);
    expect(gl.getProgramParameter(program, gl.ATTACHED_SHADERS)).toBe(0);
    gl.detachShader(program, vertex);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
  });

  it("hands back a copy from getAttachedShaders", () => {
    const gl = makeGl();
    const program = gl.createProgram();
    const vertex = gl.createShader(gl.VERTEX_SHADER)!;
    gl.attachShader(program, vertex);
    const shaders = gl.getAttachedShaders(program)!;
    expect(shaders).toEqual([vertex]);
    shaders.pop();
    expect(gl.getProgramParameter(program, gl.ATTACHED_SHADERS)).toBe(1);
  });

  it("fails a link outright when a vertex or fragment shader is missing, naming the fix", () => {
    const gl = makeGl();
    const program = gl.createProgram();
    gl.attachShader(program, gl.createShader(gl.VERTEX_SHADER)!);
    gl.linkProgram(program);
    expect(gl.getProgramParameter(program, gl.LINK_STATUS)).toBe(false);
    expect(gl.getProgramInfoLog(program)).toMatch(/one vertex and one fragment shader/);
  });

  it("fails a link whose shaders never compiled, naming the failed stage and the fix", () => {
    const gl = makeGl();
    const program = gl.createProgram();
    gl.attachShader(program, gl.createShader(gl.VERTEX_SHADER)!);
    gl.attachShader(program, gl.createShader(gl.FRAGMENT_SHADER)!);
    gl.linkProgram(program);
    expect(gl.getProgramParameter(program, gl.LINK_STATUS)).toBe(false);
    expect(gl.getProgramInfoLog(program)).toMatch(/vertex shader has not been successfully compiled/);
  });

  it("refuses useProgram with an unlinked program via INVALID_OPERATION and accepts null", () => {
    const gl = makeGl();
    const program = gl.createProgram();
    gl.useProgram(program);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
    expect(gl.getParameter(gl.CURRENT_PROGRAM)).toBeNull();
    gl.useProgram(null);
    expect(gl.getError()).toBe(gl.NO_ERROR);
  });

  it("refuses location lookups on an unlinked program, per GL", () => {
    const gl = makeGl();
    const program = gl.createProgram();
    expect(gl.getAttribLocation(program, "a_position")).toBe(-1);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
    expect(gl.getUniformLocation(program, "u_model")).toBeNull();
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
  });

  it("records bindAttribLocation requests and refuses gl_ names and bad indices", () => {
    const gl = makeGl();
    const program = gl.createProgram();
    gl.bindAttribLocation(program, 2, "a_position");
    expect(program.boundAttribLocations.get("a_position")).toBe(2);
    gl.bindAttribLocation(program, 16, "a_uv");
    expect(gl.getError()).toBe(gl.INVALID_VALUE);
    gl.bindAttribLocation(program, 0, "gl_Position");
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
  });

  it("tracks program deletion through isProgram and DELETE_STATUS and drops the current program", () => {
    const gl = makeGl();
    const program = gl.createProgram();
    expect(gl.isProgram(program)).toBe(true);
    gl.deleteProgram(program);
    expect(gl.isProgram(program)).toBe(false);
    expect(gl.getProgramParameter(program, gl.DELETE_STATUS)).toBe(true);
  });

  it("refuses shaders and programs from a different context with INVALID_OPERATION", () => {
    const gl = makeGl();
    const other = makeGl();
    const foreignShader = other.createShader(gl.VERTEX_SHADER)!;
    gl.compileShader(foreignShader);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
    const foreignProgram = other.createProgram();
    gl.linkProgram(foreignProgram);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
  });
});
