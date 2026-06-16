"""Tests for physics core."""

import numpy as np
import pytest
from model.physics import cell_temperature, dc_power, annual_energy


class TestCellTemperature:
    """Test NOCT cell-temperature model."""

    def test_zero_irradiance(self):
        """At zero irradiance, T_cell = T_amb."""
        t_amb = np.array([20.0])
        ghi = np.array([0.0])
        t_cell = cell_temperature(t_amb, ghi)
        assert np.isclose(t_cell[0], 20.0)

    def test_standard_conditions(self):
        """At 1000 W/m² and NOCT conditions, verify formula."""
        # At NOCT (45 °C measured at 20 °C ambient, 800 W/m² irradiance):
        # T_cell = 20 + (45 - 20) / 800 * 800 = 20 + 25 = 45
        t_amb = np.array([20.0])
        ghi = np.array([800.0])
        t_cell = cell_temperature(t_amb, ghi, noct=45.0)
        assert np.isclose(t_cell[0], 45.0)


class TestDCPower:
    """Test DC power computation."""

    def test_known_value(self):
        """At STC (1000 W/m², 25 °C), expect rated power."""
        ghi = np.array([1000.0])
        t_cell = np.array([25.0])
        capacity_kwp = 100.0
        p_dc = dc_power(ghi, t_cell, capacity_kwp)
        # P_dc = 100 * (1000/1000) * (1 + gamma*(25-25)) = 100 kW
        assert np.isclose(p_dc[0], capacity_kwp)

    def test_zero_irradiance(self):
        """At zero irradiance, power is zero."""
        ghi = np.array([0.0])
        t_cell = np.array([30.0])
        p_dc = dc_power(ghi, t_cell, 100.0)
        assert np.isclose(p_dc[0], 0.0)

    def test_temperature_derating(self):
        """Hotter temperature should reduce power."""
        ghi = np.array([1000.0])
        t_cell_cool = np.array([25.0])
        t_cell_hot = np.array([35.0])
        capacity_kwp = 100.0

        p_dc_cool = dc_power(ghi, t_cell_cool, capacity_kwp)
        p_dc_hot = dc_power(ghi, t_cell_hot, capacity_kwp)

        assert p_dc_hot[0] < p_dc_cool[0], "Hotter cells should have lower power"


class TestAnnualEnergy:
    """Test annual energy computation."""

    def test_shape(self):
        """Annual energy should return a scalar."""
        ghi = np.zeros(8760)
        t_amb = np.ones(8760) * 25.0
        e_year = annual_energy(ghi, t_amb, 100.0)
        assert isinstance(e_year, (float, np.floating))

    def test_hotter_is_lower(self):
        """Higher ambient temperature must reduce annual energy (gamma < 0)."""
        rng = np.random.default_rng(42)
        ghi = np.abs(rng.normal(400, 200, 8760))
        t_cool = np.ones(8760) * 10.0
        t_hot  = np.ones(8760) * 25.0
        assert annual_energy(ghi, t_cool, 100.0) > annual_energy(ghi, t_hot, 100.0)

    def test_yield_bounds(self):
        """Multi-year mean specific yield for a German park must be in 800–1200 kWh/kWp/yr."""
        from model.config import SPECIFIC_YIELD_MIN, SPECIFIC_YIELD_MAX
        import pandas as pd
        from pathlib import Path
        era5_csv = Path("backend/CDS Data/era5_data/Eggebek_Solar_Park.csv")
        if not era5_csv.exists():
            pytest.skip("ERA5 CSV not available")
        df = pd.read_csv(era5_csv)
        ghi  = np.where(np.isnan(df["shortwave_radiation"].values), 0.0, df["shortwave_radiation"].values)
        temp = df["temperature_2m"].values.astype(float)
        # Average over all complete years — single years vary ±10% due to weather
        n_years = len(ghi) // 8760
        yearly = [annual_energy(ghi[y*8760:(y+1)*8760], temp[y*8760:(y+1)*8760], capacity_kwp=1.0)
                  for y in range(n_years)]
        mean_yield = float(np.mean(yearly))
        assert SPECIFIC_YIELD_MIN <= mean_yield <= SPECIFIC_YIELD_MAX, (
            f"Mean specific yield {mean_yield:.0f} kWh/kWp/yr out of German bounds "
            f"[{SPECIFIC_YIELD_MIN}, {SPECIFIC_YIELD_MAX}]"
        )

    def test_reproducible(self):
        """Same RNG seed must produce identical simulation results."""
        from model.montecarlo import simulate
        from model.data import ParkSpecs, BaselineWeather, ClimateDeltas
        park = ParkSpecs(name="test", lat=52.0, lon=13.0, capacity_kwp=10_000.0)
        # ~120 W/m² mean (realistic German annual average including nights/winter)
        ghi  = np.clip(np.random.default_rng(0).normal(120, 150, 8760 * 5), 0, None)
        temp = np.random.default_rng(1).normal(10, 8, 8760 * 5)
        baseline = BaselineWeather(ghi=ghi, temp_amb=temp)
        deltas = ClimateDeltas(
            scenario="RCP4.5",
            dT_per_year=np.linspace(0, 1.5, 31),
            dT_model_std=np.full(31, 0.3),
        )
        pred_a = simulate(park, baseline, deltas, n_draws=200, seed=42)
        pred_b = simulate(park, baseline, deltas, n_draws=200, seed=42)
        np.testing.assert_array_equal(pred_a.p50, pred_b.p50)
        np.testing.assert_array_equal(pred_a.baseline_annual, pred_b.baseline_annual)

    def test_delta_sign(self):
        """RCP8.5 lifetime output must be <= RCP4.5 at sufficient MC draws (mean effect)."""
        from model.montecarlo import simulate
        from model.data import ParkSpecs, BaselineWeather, ClimateDeltas
        park = ParkSpecs(name="test", lat=52.0, lon=13.0, capacity_kwp=10_000.0)
        rng  = np.random.default_rng(7)
        ghi  = np.clip(rng.normal(120, 150, 8760 * 10), 0, None)
        temp = rng.normal(10, 6, 8760 * 10)
        baseline = BaselineWeather(ghi=ghi, temp_amb=temp)
        # Large, unambiguous warming signals so climate effect dominates MC noise
        deltas_45 = ClimateDeltas("RCP4.5", np.linspace(0, 2.0, 31), np.full(31, 0.1))
        deltas_85 = ClimateDeltas("RCP8.5", np.linspace(0, 4.0, 31), np.full(31, 0.1))
        pred_45 = simulate(park, baseline, deltas_45, n_draws=500, seed=42)
        pred_85 = simulate(park, baseline, deltas_85, n_draws=500, seed=42)
        assert pred_85.lifetime_p50 < pred_45.lifetime_p50, (
            f"RCP8.5 P50 ({pred_85.lifetime_p50:.0f}) should be < RCP4.5 P50 ({pred_45.lifetime_p50:.0f})"
        )
