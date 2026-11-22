//! Remoção de sequências ANSI para leitura de saída de terminal por agentes e indexação.

/// Remove CSI/OSC/escapes simples e resolve retornos de carro (`\r`) como o terminal faria.
pub fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\x1b' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('[') => {
                // CSI: parâmetros até um byte final 0x40..=0x7E
                for n in chars.by_ref() {
                    if ('\u{40}'..='\u{7e}').contains(&n) {
                        break;
                    }
                }
            }
            Some(']') => {
                // OSC: termina em BEL ou ESC \
                while let Some(n) = chars.next() {
                    if n == '\x07' {
                        break;
                    }
                    if n == '\x1b' {
                        chars.next();
                        break;
                    }
                }
            }
            Some(_) | None => {}
        }
    }
    // Resolve \r: mantém só o texto após o último \r de cada linha.
    out.split('\n')
        .map(|l| {
            let l = l.trim_end_matches('\r');
            l.rsplit('\r').next().unwrap_or("")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Últimas `n` linhas do texto já limpo.
pub fn last_lines(text: &str, n: usize) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.len().saturating_sub(n);
    lines[start..].join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_colors_and_osc() {
        assert_eq!(strip_ansi("\x1b[31mred\x1b[0m ok"), "red ok");
        assert_eq!(strip_ansi("\x1b]0;titulo\x07texto"), "texto");
    }

    #[test]
    fn resolves_carriage_return() {
        assert_eq!(strip_ansi("10%\r50%\r100%\nfim"), "100%\nfim");
    }

    #[test]
    fn last_lines_works() {
        assert_eq!(last_lines("a\nb\nc", 2), "b\nc");
    }
}
