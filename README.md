# SimpleBEM

**SimpleBEM** is a 1D Building Energy Model that implements a discrete-time thermodynamic simulation using an explicit Euler integration scheme. This repository contains the Python core engine, a FastAPI server wrapper, a React-based interactive dashboard, and analysis notebooks.

## Architecture

The system functions as a state machine where the physical parameters and current thermodynamic states are stored. The model advances the simulation by a specified time delta (`dt`), ingests external forcing variables (ambient conditions, radiation, etc.), mutates the internal state, and returns the updated state dictionary.

- **Python Core (`simpleBEM.py`)**: Defines the `BuildingEnergyModel` class with structural properties, thermal capacitance, environment variables, HVAC setpoints, and dynamic state variables (e.g., prognostic surface temperatures, indoor temperature/humidity).
- **API (`bem_api.py`)**: A FastAPI implementation to interact with the core engine and serve simulation data.
- **Dashboard (`bem_dashboard.jsx`)**: An interactive dashboard built with React and Recharts to visualize the sensible and latent balances alongside temperatures from the envelope.
- **Jupyter Notebook (`SimpleBEM_test.ipynb`)**: For step-by-step testing, graphical plotting, and advanced analysis of the thermal dynamics.

## Execution Flow

The `step()` method requires:
- `dt`: Float, representing seconds per time step.
- `forcing`: Dictionary containing keys: `time_hours`, `t_amb`, `q_amb`, `sw_in`, `wind_speed`, `ac_on`, `occup_sens`, `equip_sens`, `occup_lat`, `vent_rate`, and optionally `t_ground`.

1. **Solar Geometry**: Computes zenith and azimuth angles, handles diffuse/direct partitioning, and calculates incident radiation.
2. **Envelope Energy Balance**: Calculates shortwave absorption, longwave emission, external convection, and internal conduction over Roof, North, South, East, and West surfaces.
3. **Indoor Sensible Balance**: Aggregates sensible loads and predicts the next indoor temperature `t_in_next`.
4. **Indoor Latent Balance**: Aggregates latent loads and predicts specific humidity `q_in_next`.
5. **HVAC Intervention**: If `ac_on` is True and predictions violate setpoints, it derives required sensible and latent interventions (`q_hvac`, `e_hvac`).
6. **State Mutation**: Updates state values based on total net fluxes.

## Setup Requirements

### Python Engine
To install and run the Python backend and FastAPI setup:

```bash
# Create a virtual environment (optional)
python -m venv venv
source venv/bin/activate  # On Windows use `venv\Scripts\activate`

# Install dependencies
pip install -r requirements.txt

# Run the FastAPI server
uvicorn bem_api:app --reload
```

### Dashboard GUI
The frontend component depends on React and Recharts:

```bash
# Install node packages
npm install
```

## Constraints
- **Numerical Stability**: The explicit Euler integration scheme requires a sufficiently small `dt`. High thermal conductivity, low envelope heat capacity, or large time steps will cause the numerical solution to diverge.
- **Stateless Forcing**: The model has no memory of past forcing variable schedules. Ensure diurnal or weather-based patterns are accurately produced and passed each step.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
