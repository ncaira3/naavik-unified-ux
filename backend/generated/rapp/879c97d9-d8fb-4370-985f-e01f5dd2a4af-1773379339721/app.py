```python
"""
EIAP rApp: builder_879c97d9d8

This rApp monitors the KPI 'avg_rrc_connected' and when its value exceeds 300,
it triggers an action to set the parameter 'retsubunit.electricalAntennaTilt' to 2.

The script uses EIAP DataAdapter to query KPI data and R1ServiceClient to execute
parameterized actions on the network element.

Author: Telecom Automation Engineer
Date: 2024-06
"""

import logging
from eiap import DataAdapter, R1ServiceClient, EIAPException

# Configure logger for the rApp
logger = logging.getLogger('builder_879c97d9d8')
logger.setLevel(logging.INFO)


class Builder879c97d9d8:
    """
    EIAP rApp main class for builder_879c97d9d8.
    """

    def __init__(self):
        """
        Initialize DataAdapter and R1ServiceClient instances.
        """
        try:
            self.data_adapter = DataAdapter()
            self.r1_client = R1ServiceClient()
            logger.info("Initialized DataAdapter and R1ServiceClient successfully.")
        except EIAPException as e:
            logger.error(f"Failed to initialize EIAP clients: {e}")
            raise

    def query_avg_rrc_connected(self):
        """
        Query the KPI 'avg_rrc_connected' using DataAdapter.

        Returns:
            float: The average RRC connected value.

        Raises:
            EIAPException: If data query fails.
        """
        try:
            # KPI query parameters - adjust as per actual KPI name and filters
            kpi_name = "avg_rrc_connected"
            # Query latest KPI value without filters for simplicity
            response = self.data_adapter.query_kpi(kpi_name=kpi_name)
            # Assume response is a dict with 'value' key containing KPI value
            avg_rrc_connected = float(response.get('value', 0))
            logger.debug(f"Queried KPI '{kpi_name}': {avg_rrc_connected}")
            return avg_rrc_connected
        except EIAPException as e:
            logger.error(f"Error querying KPI '{kpi_name}': {e}")
            raise

    def set_electrical_antenna_tilt(self, tilt_value):
        """
        Execute action to set 'retsubunit.electricalAntennaTilt' parameter.

        Args:
            tilt_value (int): The tilt value to set.

        Raises:
            EIAPException: If action execution fails.
        """
        try:
            # Parameterized action payload
            action_name = "setParameter"
            # Target parameter path and value
            parameters = {
                "parameterPath": "retsubunit.electricalAntennaTilt",
                "parameterValue": tilt_value
            }
            logger.info(f"Executing action '{action_name}' with parameters: {parameters}")
            # Execute action via R1ServiceClient
            self.r1_client.execute_action(action_name=action_name, parameters=parameters)
            logger.info(f"Successfully set 'retsubunit.electricalAntennaTilt' to {tilt_value}.")
        except EIAPException as e:
            logger.error(f"Failed to set electrical antenna tilt: {e}")
            raise

    def execute(self):
        """
        Main execution method for the rApp.

        Queries KPI condition and triggers action if condition is met.
        """
        try:
            avg_rrc = self.query_avg_rrc_connected()
            logger.info(f"avg_rrc_connected KPI value: {avg_rrc}")

            # Condition check: avg_rrc_connected > 300
            if avg_rrc > 300:
                logger.info("Condition met: avg_rrc_connected > 300. Triggering action.")
                self.set_electrical_antenna_tilt(2)
            else:
                logger.info("Condition not met: avg_rrc_connected <= 300. No action taken.")
        except EIAPException:
            logger.error("Execution aborted due to EIAP exception.")
        except Exception as e:
            logger.error(f"Unexpected error during execution: {e}")


if __name__ == "__main__":
    # Setup console logging handler
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    formatter = logging.Formatter('[%(asctime)s] %(levelname)s - %(message)s')
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    # Instantiate and run the rApp
    app = Builder879c97d9d8()
    app.execute()
```