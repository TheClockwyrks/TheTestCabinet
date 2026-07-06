use super::*;
use crate::color::Color;

#[test]
fn shape_parses() {
    assert_eq!(Shape::parse("sphere").unwrap(), Shape::Sphere);
    assert_eq!(Shape::parse("plane").unwrap(), Shape::Plane);
    assert!(Shape::parse("torus").is_err());
}

#[test]
fn surfaces_are_non_degenerate() {
    for shape in [Shape::Sphere, Shape::Cube, Shape::Cylinder, Shape::Plane] {
        let (pos, nrm, idx) = build_surface(shape);
        assert_eq!(pos.len(), nrm.len(), "{shape:?}");
        assert!(pos.len() % 3 == 0);
        assert!(!idx.is_empty(), "{shape:?} has no triangles");
        assert!(idx.iter().all(|&i| (i as usize) < pos.len() / 3), "{shape:?} index oob");
    }
}

#[test]
fn triplanar_sample_of_uniform_map_is_that_color() {
    let map = Raster::filled(8, 8, Color::new(0.2, 0.4, 0.6, 1.0));
    let c = triplanar_sample(&map, [0.3, -0.5, 0.7], [0.0, 1.0, 0.0], 1.0);
    assert!((c[0] - 0.2).abs() < 1e-3);
    assert!((c[1] - 0.4).abs() < 1e-3);
    assert!((c[2] - 0.6).abs() < 1e-3);
}

#[test]
fn ao_darkens_triplanar_color() {
    let base = Raster::filled(8, 8, Color::new(1.0, 1.0, 1.0, 1.0));
    let ao = Raster::filled(8, 8, Color::new(0.5, 0.5, 0.5, 1.0));
    let maps = MaterialMaps {
        base_color: &base,
        ao: Some(&ao),
        emissive: None,
        tiling: 1.0,
    };
    let (pos, nrm, _) = build_surface(Shape::Cube);
    let colors = triplanar_colors(&pos, &nrm, &maps);
    assert!(colors[0] < 0.6, "AO should darken: {}", colors[0]);
}
