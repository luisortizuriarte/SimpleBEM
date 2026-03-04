# SimpleBEM

**SimpleBEM** is a 1D Building Energy Model that implements a discrete-time thermodynamic simulation using an explicit Euler integration scheme. The model calculates the thermal and moisture evolution of a single-zone building by solving energy balances for five envelope surfaces (4 walls, 1 roof) and the interior air volume.

## Overview

The `BuildingEnergyModel` class functions as a state machine where physical parameters and current thermodynamic states are stored. The model advances the simulation by a specified time delta (`dt`), ingests external forcing variables (ambient conditions, radiation, occupancy, etc.), updates the internal state, and returns the new state dictionary.

## Features

- **Multi-Surface Envelope Modeling**: Prognostic temperature calculations for Roof, North, South, East, and West surfaces
- **Solar Geometry**: Automatic calculation of solar zenith and azimuth angles, direct/diffuse radiation partitioning
- **Energy Balance Components**:
  - Shortwave solar absorption
  - Longwave radiation exchange with sky
  - External convection (wind-dependent)
  - Internal conduction through envelope
  - Window solar heat gain
  - Ground heat transfer
- **HVAC Control**: Thermostat-based heating, cooling, and dehumidification with configurable setpoints and COP values
- **Latent and Sensible Load Tracking**: Separate accounting for temperature and humidity evolution

## Installation

SimpleBEM requires only Python's standard library. For visualization and analysis, install optional dependencies:

```bash
# Create a virtual environment (recommended)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install optional dependencies for testing and visualization
pip install -r requirements.txt
```

## Usage

### Basic Example

```python
from simpleBEM import BuildingEnergyModel

# Define building parameters
parameters = {
    'length_ew': 10.0,          # Building length (m)
    'width_ns': 10.0,           # Building width (m)
    'height': 2.5,              # Building height (m)
    'latitude': 38.9,           # Site latitude (degrees)
    'day_of_year': 172,         # Julian day (1-365)
    'wall_thickness': 0.20,     # Wall thickness (m)
    'wall_density': 1800.0,     # Wall density (kg/m³)
    'wall_cp': 840.0,           # Wall specific heat (J/kg-K)
    'wall_k': 0.1,              # Wall conductivity (W/m-K)
    'wall_albedo': 0.3,         # Wall reflectivity (-)
    'roof_albedo': 0.2,         # Roof reflectivity (-)
    'frac_win': 0.15,           # Window fraction (-)
    'shgc': 0.4,                # Solar heat gain coefficient (-)
    'tc_target': 297.0,         # Cooling setpoint (K)
    'th_target': 293.0,         # Heating setpoint (K)
    't_init': 297.0,            # Initial indoor temperature (K)
    'q_init': 0.015,            # Initial specific humidity (kg/kg)
}

# Initialize the model
bem = BuildingEnergyModel(parameters)

# Define forcing conditions for a time step
forcing = {
    'time_hours': 12.0,         # Time of day (hours)
    't_amb': 303.0,             # Ambient temperature (K)
    'q_amb': 0.018,             # Ambient specific humidity (kg/kg)
    'sw_in': 800.0,             # Global horizontal solar radiation (W/m²)
    'wind_speed': 3.0,          # Wind speed (m/s)
    'ac_on': True,              # HVAC system enabled
    'occup_sens': 200.0,        # Occupant sensible heat (W)
    'occup_lat': 0.0001,        # Occupant latent moisture (kg/s)
    'equip_sens': 150.0,        # Equipment sensible heat (W)
    'vent_rate': 0.05,          # Ventilation rate (m³/s)
    't_ground': 295.0           # Ground temperature (K, optional)
}

# Advance simulation by one time step
dt = 60.0  # Time step (seconds)
state = bem.step(dt, forcing)

# Access results
print(f"Indoor Temperature: {state['t_in']:.2f} K")
print(f"Indoor Humidity: {state['q_in']:.5f} kg/kg")
print(f"Cooling Output: {state['sens_cool_out']:.2f} W")
```

## Model Parameters

### Required Initialization Parameters

The `BuildingEnergyModel` constructor accepts a dictionary with the following keys:

| Parameter | Units | Description |
|-----------|-------|-------------|
| `length_ew` | m | Building length in East-West direction |
| `width_ns` | m | Building width in North-South direction |
| `height` | m | Building height |
| `latitude` | degrees | Geographic latitude |
| `day_of_year` | 1-365 | Julian day for solar calculations |
| `wall_thickness` | m | Envelope thickness |
| `wall_density` | kg/m³ | Envelope material density |
| `wall_cp` | J/kg-K | Envelope specific heat capacity |
| `wall_k` | W/m-K | Envelope thermal conductivity |
| `wall_emissivity` | - | Exterior surface longwave emissivity (0-1) |
| `wall_albedo` | - | Wall shortwave reflectivity (0-1) |
| `roof_albedo` | - | Roof shortwave reflectivity (0-1) |
| `frac_win` | - | Window-to-wall ratio (0-1) |
| `shgc` | - | Window solar heat gain coefficient (0-1) |
| `internal_mass_per_area` | J/m²-K | Internal thermal mass per floor area |
| `rho` | kg/m³ | Indoor air density |
| `cp` | J/kg-K | Air specific heat at constant pressure |
| `cop_cool` | - | Cooling system coefficient of performance |
| `cop_heat` | - | Heating system coefficient of performance |
| `tc_target` | K | Cooling thermostat setpoint |
| `th_target` | K | Heating thermostat setpoint |
| `q_target` | kg/kg | Dehumidification specific humidity target |
| `t_init` | K | Initial indoor air temperature |
| `q_init` | kg/kg | Initial indoor specific humidity |
| `t_wall_init` | K | Initial envelope surface temperatures |

### Forcing Variables

The `step()` method requires a forcing dictionary with these keys:

| Variable | Units | Description |
|----------|-------|-------------|
| `time_hours` | hours | Current simulation time (0-24) |
| `t_amb` | K | Ambient outdoor air temperature |
| `q_amb` | kg/kg | Ambient outdoor specific humidity |
| `sw_in` | W/m² | Global horizontal solar radiation |
| `wind_speed` | m/s | Local wind speed |
| `ac_on` | bool | HVAC system operational status |
| `occup_sens` | W | Sensible heat from occupants |
| `occup_lat` | kg/s | Latent moisture from occupants |
| `equip_sens` | W | Sensible heat from equipment |
| `vent_rate` | m³/s | Outdoor air ventilation flow rate |
| `t_ground` | K | Deep ground temperature (optional, default: 295 K) |

## Return Values

The `step()` method returns a dictionary containing:

| Key | Units | Description |
|-----|-------|-------------|
| `t_in` | K | Updated indoor air temperature |
| `q_in` | kg/kg | Updated indoor specific humidity |
| `sens_cool_out` | W | Sensible heat rejected by cooling system |
| `sens_heat_out` | W | Sensible heat rejected by heating system |
| `t_roof` | K | Roof exterior surface temperature |
| `t_wall_n` | K | North wall exterior surface temperature |
| `t_wall_s` | K | South wall exterior surface temperature |
| `t_wall_e` | K | East wall exterior surface temperature |
| `t_wall_w` | K | West wall exterior surface temperature |

## Execution Flow

Each call to `step()` performs the following sequence:

1. **Solar Geometry**: Computes zenith and azimuth angles based on latitude, day of year, and time of day. Partitions global horizontal radiation into direct normal and diffuse components.

2. **Surface Incident Radiation**: Calculates shortwave radiation incident on each of the five envelope surfaces (Roof, N, S, E, W) accounting for surface orientation.

3. **Envelope Energy Balance**: For each surface, computes:
   - Shortwave absorption (function of albedo)
   - Longwave radiation exchange with sky
   - External convection (wind-dependent)
   - Internal conduction through envelope
   - Updates prognostic surface temperature using explicit Euler integration

4. **Indoor Sensible Balance**: Aggregates all sensible heat sources:
   - Conduction from envelope surfaces
   - Window solar heat gain
   - Occupant and equipment loads
   - Ventilation
   - Ground heat transfer
   - Predicts next indoor temperature

5. **Indoor Latent Balance**: Aggregates moisture sources:
   - Occupant latent loads
   - Ventilation moisture exchange
   - Predicts next specific humidity

6. **HVAC Intervention**: If `ac_on` is True:
   - Applies cooling if predicted temperature exceeds `tc_target`
   - Applies heating if predicted temperature falls below `th_target`
   - Applies dehumidification if predicted humidity exceeds `q_target`
   - Calculates anthropogenic heat rejection

7. **State Update**: Applies HVAC corrections and advances all state variables to the next time step.

## Important Constraints

### Numerical Stability

The explicit Euler integration scheme requires careful selection of the time step `dt`. The model may become numerically unstable with:
- Very small time steps (dt < 1 second)
- Very large time steps (dt > 600 seconds)
- High thermal conductivity combined with low envelope heat capacity
- Extreme forcing conditions

**Recommended time step**: 60-300 seconds for typical building constructions.

### Stateless Design

The model maintains only the current state. It has no memory of past forcing variable schedules. For diurnal or weather-driven simulations, the calling code must:
- Generate and pass appropriate time-varying forcing values for each step
- Maintain external records of simulation history if needed
- Handle time management and iteration loops

## Testing

See `SimpleBEM_test.ipynb` for examples of multi-step simulations with visualization of temperature evolution, energy balances, and system performance.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

**Notice:** This model was produced with assistance from an AI model.
