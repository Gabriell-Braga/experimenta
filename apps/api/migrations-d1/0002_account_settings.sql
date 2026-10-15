-- Amostragem do mapa de calor por conta (D-038). NULL = padrão do servidor.
ALTER TABLE accounts ADD COLUMN heatmap_sample_rate REAL;
