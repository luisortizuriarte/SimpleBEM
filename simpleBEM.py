"""
1D Building Energy Model

This script solves the indoor sensible heat and specific humidity balance equations.
It uses an explicit Euler time-integration method. The equations replicate the
physics described in the WRF BEP-BEM documentation, upgraded with multi-surface
prognostic temperatures and solar incidence geometry.
"""

from typing import Dict
import math
import matplotlib.pyplot as plt

class BuildingEnergyModel:
    """
    A class representing a single-zone 1D Building Energy Model.

    This model calculates the thermal and moisture evolution of a building zone
    by solving energy balances for five envelope surfaces (4 walls, 1 roof) and
    the interior air volume.
    """

    def __init__(self, parameters: Dict[str, float]):
        """
        Initializes the model with building geometry, material properties, and initial states.

        Args:
            parameters (Dict[str, float]): A dictionary containing the following keys:
                - 'length_ew' (m): Building length in the East-West direction.
                - 'width_ns' (m): Building width in the North-South direction.
                - 'height' (m): Building height.
                - 'internal_mass_per_area' (J/m²-K): Internal thermal mass (furniture, etc.) per floor area.
                - 'latitude' (degrees): Geographic latitude of the building site.
                - 'day_of_year' (1-365): Julian day for solar declination calculations.
                - 'rho' (kg/m³): Density of the indoor air.
                - 'cp' (J/kg-K): Specific heat capacity of the indoor air at constant pressure.
                - 'frac_win' (-): Fraction of vertical wall area occupied by windows (0.0 to 1.0).
                - 'cop_cool' (-): Coefficient of Performance for the cooling system.
                - 'cop_heat' (-): Coefficient of Performance for the heating system.
                - 'tc_target' (K): Target thermostat setpoint for cooling.
                - 'th_target' (K): Target thermostat setpoint for heating.
                - 'q_target' (kg/kg): Target specific humidity for the dehumidification system.
                - 'wall_thickness' (m): Thickness of the opaque envelope (walls and roof).
                - 'wall_density' (kg/m³): Density of the envelope material.
                - 'wall_cp' (J/kg-K): Specific heat capacity of the envelope material.
                - 'wall_k' (W/m-K): Thermal conductivity of the envelope material.
                - 'wall_emissivity' (-): Longwave emissivity of the exterior surfaces.
                - 'shgc' (-): Solar Heat Gain Coefficient of the windows.
                - 'wall_albedo' (-): Shortwave reflectivity of the exterior wall surfaces.
                - 'roof_albedo' (-): Shortwave reflectivity of the exterior roof surface.
                - 't_init' (K): Initial indoor air temperature.
                - 'q_init' (kg/kg): Initial indoor specific humidity.
                - 't_wall_init' (K): Initial temperature for all envelope surfaces.
        """
        # Building Geometry
        self.length_ew = parameters.get('length_ew', 10.0)
        self.width_ns = parameters.get('width_ns', 10.0)
        self.height = parameters.get('height', 2.5)

        # Computed Geometric Properties
        self.volume = self.length_ew * self.width_ns * self.height
        self.a_roof = self.length_ew * self.width_ns
        self.a_floor = self.length_ew * self.width_ns
        self.a_wall_n = self.length_ew * self.height
        self.a_wall_s = self.length_ew * self.height
        self.a_wall_e = self.width_ns * self.height
        self.a_wall_w = self.width_ns * self.height

        # Internal thermal mass
        self.internal_mass_per_area = parameters.get('internal_mass_per_area', 150000.0)
        self.internal_heat_capacity = self.a_floor * self.internal_mass_per_area

        # Location and Air Properties
        self.lat_rad = math.radians(parameters.get('latitude', 38.9))
        self.doy = parameters.get('day_of_year', 172)
        self.rho = parameters.get('rho', 1.2)
        self.cp = parameters.get('cp', 1005.0)

        # System Properties
        self.frac_win = parameters.get('frac_win', 0.15)
        self.cop_cool = parameters.get('cop_cool', 3.0)
        self.cop_heat = parameters.get('cop_heat', 2.5)
        self.t_cool_target = parameters.get('tc_target', 297.0)
        self.t_heat_target = parameters.get('th_target', 293.0)
        self.q_target = parameters.get('q_target', 0.012)

        # Envelope physical properties
        self.env_thickness = parameters.get('wall_thickness', 0.20)
        self.env_density = parameters.get('wall_density', 1800.0)
        self.env_cp = parameters.get('wall_cp', 840.0)
        self.env_k = parameters.get('wall_k', 0.1)
        self.env_emiss = parameters.get('wall_emissivity', 0.9)
        self.shgc = parameters.get('shgc', 0.4)

        # Surface Albedo
        self.wall_albedo = parameters.get('wall_albedo', 0.3)
        self.roof_albedo = parameters.get('roof_albedo', 0.2)

        # State variables
        self.t_in = parameters.get('t_init', 297.0)
        self.q_in = parameters.get('q_init', 0.015)

        # Prognostic temperatures for each envelope surface
        t_init_env = parameters.get('t_wall_init', 298.0)
        self.t_surf = {
            'Roof': t_init_env,
            'N': t_init_env,
            'S': t_init_env,
            'E': t_init_env,
            'W': t_init_env
        }

    def _calculate_solar_incidence(self, time_hours: float, sw_in: float) -> Dict[str, float]:
        """
        Calculates the solar radiation incident on each building surface based on
        solar geometry and orientation.

        Args:
            time_hours (h): Current simulation time in hours.
            sw_in (W/m²): Global horizontal shortwave solar radiation.

        Returns:
            Dict[str, float]: Incident shortwave radiation for each cardinal surface (W/m²).
        """
        declination = 23.45 * (math.pi / 180.0) * math.sin(2.0 * math.pi / 365.0 * (284.0 + self.doy))
        hour_angle = (time_hours - 12.0) * math.pi / 12.0

        cos_zenith = math.sin(self.lat_rad) * math.sin(declination) + math.cos(self.lat_rad) * math.cos(declination) * math.cos(hour_angle)

        # Clamp to prevent math domain error due to floating point inaccuracies
        cos_zenith = max(-1.0, min(1.0, cos_zenith))

        if cos_zenith > 0.0 and sw_in > 0.0:
            zenith = math.acos(cos_zenith)
            # Add epsilon to prevent division by zero at exact overhead zenith
            sin_zenith = max(0.0001, math.sin(zenith))

            # Calculate solar azimuth (0=N, pi/2=W, pi=S, -pi/2=E)
            sin_az = (math.cos(declination) * math.sin(hour_angle)) / sin_zenith
            cos_az = (math.sin(declination) * math.cos(self.lat_rad) - math.cos(declination) * math.sin(self.lat_rad) * math.cos(hour_angle)) / sin_zenith
            azimuth = math.atan2(sin_az, cos_az)

            # Partition GHI into Direct Normal and Diffuse components
            sw_dir_norm = min(1361.0, (sw_in * 0.8) / max(0.05, cos_zenith))
            sw_diffuse = sw_in * 0.2
        else:
            zenith = math.pi / 2.0
            azimuth = 0.0
            sw_dir_norm = 0.0
            sw_diffuse = sw_in

        # Incident radiation on each surface
        surf_azimuths = {'N': 0.0, 'W': math.pi/2, 'S': math.pi, 'E': -math.pi/2}
        sw_inc = {'Roof': sw_in}

        for direction, az in surf_azimuths.items():
            cos_inc = math.sin(zenith) * math.cos(azimuth - az)
            cos_inc = max(0.0, cos_inc) # Sun must be in front of the wall
            sw_inc[direction] = (sw_dir_norm * cos_inc) + (sw_diffuse * 0.5)

        return sw_inc

    def step(self, dt: float, forcing: Dict[str, float]) -> Dict[str, float]:
        """
        Advances the simulation state by one time step using an explicit Euler integration.

        Args:
            dt (s): Time step duration.
            forcing (Dict[str, float]): A dictionary containing the following keys:
                - 't_amb' (K): Ambient outdoor air temperature.
                - 'q_amb' (kg/kg): Ambient outdoor specific humidity.
                - 'sw_in' (W/m²): Global horizontal shortwave solar radiation.
                - 'wind_speed' (m/s): Local wind speed for convection calculations.
                - 'time_hours' (h): Current simulation time in hours.
                - 'ac_on' (bool): Operational status of the HVAC system (True/False).
                - 'occup_sens' (W): Sensible heat load from building occupants.
                - 'occup_lat' (kg/s): Latent moisture load from building occupants.
                - 'equip_sens' (W): Sensible heat load from electrical equipment.
                - 'vent_rate' (m³/s): Volumetric flow rate of outdoor air ventilation.
                - 't_ground' (K, optional): Deep ground temperature. Defaults to 295.0 K.

        Returns:
            Dict[str, float]: Updated state variables including:
                - 't_in' (K): New indoor air temperature.
                - 'q_in' (kg/kg): New indoor specific humidity.
                - 'sens_cool_out' (W): Sensible heat rejected by AC to environment.
                - 'sens_heat_out' (W): Sensible heat rejected by heating system to environment.
                - 't_roof', 't_wall_s', 't_wall_n', 't_wall_e', 't_wall_w' (K): New surface temperatures.
        """
        t_amb = forcing['t_amb']
        q_amb = forcing['q_amb']
        sw_in = forcing['sw_in']
        wind_speed = forcing['wind_speed']
        time_hours = forcing['time_hours']
        ac_on = forcing['ac_on']
        occup_sens = forcing['occup_sens']
        occup_lat = forcing['occup_lat']
        equip_sens = forcing['equip_sens']
        vent_rate = forcing['vent_rate']

        # 1. Solar Geometry & Incidence Calculations
        sw_inc = self._calculate_solar_incidence(time_hours, sw_in)

        # 2. Multi-Surface Envelope Energy Balance
        h_out = 5.7 + 3.8 * wind_speed
        sigma = 5.67e-8
        t_sky = t_amb - 15.0 # Effective sky temperature approximation

        q_cond_in_total = 0.0
        q_win_total = 0.0

        areas = {
            'Roof': self.a_roof, 'N': self.a_wall_n,
            'S': self.a_wall_s, 'E': self.a_wall_e, 'W': self.a_wall_w
        }

        for surf, a_surf in areas.items():
            frac_win_surf = 0.0 if surf == 'Roof' else self.frac_win
            a_opaque = a_surf * (1.0 - frac_win_surf)
            a_win = a_surf * frac_win_surf

            t_s = self.t_surf[surf]
            sw_incident = sw_inc[surf]

            surf_albedo = self.roof_albedo if surf == 'Roof' else self.wall_albedo
            surf_abs = 1.0 - surf_albedo

            # Surface Energy Fluxes
            q_sw_abs = sw_incident * a_opaque * surf_abs
            q_lw_net = self.env_emiss * sigma * a_opaque * ((t_s ** 4) - (t_sky ** 4))
            q_conv_out = h_out * a_opaque * (t_s - t_amb)
            q_cond_in = (self.env_k / self.env_thickness) * a_opaque * (t_s - self.t_in)

            # Update prognostic envelope temperature
            heat_cap = a_opaque * self.env_thickness * self.env_density * self.env_cp
            q_surf_total = q_sw_abs - q_conv_out - q_cond_in - q_lw_net
            self.t_surf[surf] = t_s + (dt * q_surf_total) / heat_cap

            # Aggregate heat entering the zone
            q_cond_in_total += q_cond_in
            q_win_total += sw_incident * a_win * self.shgc

        # 3. Sensible Heat Balance Components
        q_int = occup_sens + equip_sens

        mass_flow = vent_rate * self.rho
        q_vent = mass_flow * self.cp * (t_amb - self.t_in)

        # Ground heat transfer
        t_ground = forcing.get('t_ground', 295.0)
        q_floor = (self.env_k / self.env_thickness) * self.a_floor * (t_ground - self.t_in)

        # Total zone heat capacity (air + internal mass)
        heat_capacity = (self.volume * self.rho * self.cp) + self.internal_heat_capacity
        q_total_no_hvac = q_int + q_win_total + q_cond_in_total + q_vent + q_floor

        # Predict indoor temperature without HVAC intervention
        t_in_next = self.t_in + (dt * q_total_no_hvac) / heat_capacity

        # Predict indoor specific humidity without HVAC intervention
        e_int = occup_lat
        e_vent = mass_flow * (q_amb - self.q_in)
        e_total_no_hvac = e_int + e_vent
        q_in_next = self.q_in + (dt * e_total_no_hvac) / (self.volume * self.rho)

        q_hvac = 0.0
        sens_cool_out = 0.0
        sens_heat_out = 0.0
        e_hvac = 0.0

        # 4. HVAC Operation and Anthropogenic Heat
        if ac_on:
            if t_in_next > self.t_cool_target:
                q_hvac = (self.t_cool_target - t_in_next) * heat_capacity / dt
                sens_cool_out = abs(q_hvac) * (1.0 + (1.0 / self.cop_cool))

            elif t_in_next < self.t_heat_target:
                q_hvac = (self.t_heat_target - t_in_next) * heat_capacity / dt
                sens_heat_out = abs(q_hvac) * (1.0 - (1.0 / self.cop_heat))

            if q_in_next > self.q_target:
                req_e_hvac = (q_in_next - self.q_target) * (self.volume * self.rho) / dt
                max_e_hvac = (self.volume * self.rho * max(0.0, self.q_in)) / dt
                e_hvac = min(req_e_hvac, max_e_hvac)

        # Update indoor temperature and humidity
        q_total = q_total_no_hvac + q_hvac
        self.t_in = self.t_in + (dt * q_total) / heat_capacity

        e_total = e_total_no_hvac - e_hvac
        self.q_in = self.q_in + (dt * e_total) / (self.volume * self.rho)
        self.q_in = max(0.0, self.q_in)

        return {
            't_in': self.t_in,
            'q_in': self.q_in,
            'sens_cool_out': sens_cool_out,
            'sens_heat_out': sens_heat_out,
            't_roof': self.t_surf['Roof'],
            't_wall_s': self.t_surf['S'],
            't_wall_n': self.t_surf['N'],
            't_wall_e': self.t_surf['E'],
            't_wall_w': self.t_surf['W']
        }