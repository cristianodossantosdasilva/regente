//! Carga: 20 terminais simultâneos com saída contínua. Verifica funcionamento, dormência (sem eventos)
//! e mede a memória agregada da árvore de processos.
#![cfg(windows)]

use regente_lib::pty::{ExitSink, OutputSink, PtyManager, SpawnSpec};
use regente_lib::sys::tree_usage;
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use sysinfo::System;

const N: usize = 20;

#[test]
fn twenty_terminals_stay_responsive_and_bounded() {
    let m = PtyManager::new();
    let events = Arc::new(AtomicUsize::new(0));
    let ev = events.clone();
    let out: OutputSink = Arc::new(move |_, _, _| {
        ev.fetch_add(1, Ordering::Relaxed);
    });
    let ex: ExitSink = Arc::new(|_, _| {});

    let t0 = Instant::now();
    for i in 0..N {
        m.spawn(
            SpawnSpec {
                id: format!("t{i}"),
                program: "cmd.exe".into(),
                args: vec![],
                cwd: None,
                env: HashMap::new(),
                cols: 120,
                rows: 30,
                // buffer pequeno de propósito: prova que o scrollback é limitado
                scrollback_bytes: Some(64 * 1024),
            },
            out.clone(),
            ex.clone(),
        )
        .unwrap();
    }
    let spawn_time = t0.elapsed();

    // Todos produzem bastante saída (~400 linhas cada).
    for i in 0..N {
        m.write(
            &format!("t{i}"),
            b"for /L %i in (1,1,400) do @echo linha-%i-carga\r",
        )
        .unwrap();
    }
    let deadline = Instant::now() + Duration::from_secs(40);
    loop {
        let done = (0..N).all(|i| {
            m.tail(&format!("t{i}"), 64 * 1024)
                .map(|t| t.contains("linha-400-carga"))
                .unwrap_or(false)
        });
        if done || Instant::now() > deadline {
            assert!(done, "algum terminal não terminou a saída a tempo");
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    // Buffers respeitam o limite configurado.
    for s in m.stats() {
        assert!(
            s.ring_bytes <= 64 * 1024,
            "buffer de {} passou do limite: {}",
            s.id,
            s.ring_bytes
        );
        assert!(s.exit.is_none(), "{} morreu", s.id);
    }

    // Dormência: com streaming desligado nenhum evento é emitido, mas o buffer continua crescendo.
    for i in 0..N {
        m.set_streaming(&format!("t{i}"), false);
    }
    let before = events.load(Ordering::Relaxed);
    for i in 0..N {
        m.write(&format!("t{i}"), b"echo dormente-ok\r").unwrap();
    }
    let deadline = Instant::now() + Duration::from_secs(15);
    while !(0..N).all(|i| {
        m.tail(&format!("t{i}"), 64 * 1024)
            .map(|t| t.contains("dormente-ok"))
            .unwrap_or(false)
    }) {
        assert!(
            Instant::now() < deadline,
            "buffer não recebeu saída durante a dormência"
        );
        std::thread::sleep(Duration::from_millis(100));
    }
    assert_eq!(
        events.load(Ordering::Relaxed),
        before,
        "terminais dormentes não devem emitir eventos"
    );

    // Memória agregada de 20 terminais (árvore de processos: cmd.exe + conhost/OpenConsole).
    let roots: Vec<(String, u32)> = m
        .stats()
        .into_iter()
        .filter_map(|s| s.pid.map(|p| (s.id, p)))
        .collect();
    let mut sys = System::new();
    tree_usage(&mut sys, &roots); // primeira leitura inicializa contadores de CPU
    std::thread::sleep(Duration::from_millis(600));
    let usage = tree_usage(&mut sys, &roots);
    let total_mb: f64 = usage.values().map(|(_, b)| *b as f64).sum::<f64>() / 1048576.0;
    println!(
        "20 terminais: spawn={spawn_time:?}, RAM agregada={total_mb:.1} MB, eventos={}",
        events.load(Ordering::Relaxed)
    );
    assert!(
        total_mb < 1500.0,
        "RAM agregada alta demais: {total_mb:.0} MB"
    );

    for i in 0..N {
        m.kill(&format!("t{i}"));
    }
    assert!(m.ids().is_empty());
}
