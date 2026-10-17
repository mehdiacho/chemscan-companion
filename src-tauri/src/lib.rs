use chemscan_rules::{Nature, SampleState, Settings};

#[tauri::command]
fn calculate(
    state: SampleState,
    nature: Nature,
    weight_grams: f64,
    version: String,
) -> Result<Settings, String> {
    chemscan_rules::calculate(state, nature, weight_grams, &version)
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![calculate])
        .run(tauri::generate_context!())
        .expect("error while running ChemScan Companion");
}
